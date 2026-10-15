"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { action, int, optStr, str, UserError } from "@/lib/actions";
import { normalizePhone } from "@/lib/auth/core";
import { clientIp, getCurrentUser } from "@/lib/auth/server";
import { cartLines, currentCustomerId, getCart, MAX_LINE_QTY, setLineQty } from "@/lib/cart";
import { randomToken, sha256 } from "@/lib/crypto";
import { getDefaultLocationId } from "@/lib/inventory";
import { notify, notifyStaff } from "@/lib/notifications";
import { orderUrl, placeOnlineOrder } from "@/lib/orders";
import { priceCart } from "@/lib/pricing";
import { rateLimit } from "@/lib/ratelimit";
import { nextNumber } from "@/lib/sequence";
import { getSetting } from "@/lib/settings";

export const addToCartAction = action(async (fd) => {
  const variantId = str(fd, "variantId");
  const qty = int(fd, "qty", "quantity");
  if (qty < 1 || qty > MAX_LINE_QTY) throw new UserError("Choose a quantity between 1 and 99.");
  const v = await db.query.productVariants.findFirst({ where: eq(schema.productVariants.id, variantId), with: { product: true } });
  if (!v || !v.isActive || v.priceCents == null || v.product.status !== "PUBLISHED") throw new UserError("This item isn't available.");
  const cart = await getCart(true);
  if (!cart) throw new UserError("Your cart couldn't be opened. Check that cookies are allowed.");
  const existing = (await cartLines(cart.id)).find((l) => l.variantId === variantId)?.qty ?? 0;
  await setLineQty(cart.id, variantId, existing + qty);
  revalidatePath("/", "layout");
  if (str(fd, "buyNow") === "1") redirect("/checkout");
  return { ok: true, message: "Added to your cart.", data: { added: true } };
});

export const updateCartAction = action(async (fd) => {
  const cart = await getCart(true);
  if (!cart) throw new UserError("Your cart has expired.");
  const variantId = str(fd, "variantId");
  const op = str(fd, "op");
  const current = (await cartLines(cart.id)).find((l) => l.variantId === variantId)?.qty ?? 0;
  const next = op === "remove" ? 0 : op === "inc" ? current + 1 : op === "dec" ? current - 1 : int(fd, "qty", "quantity");
  await setLineQty(cart.id, variantId, next);
  revalidatePath("/", "layout");
  return { ok: true, message: op === "remove" || next <= 0 ? "Removed." : "Cart updated." };
});

export const applyCouponAction = action(async (fd) => {
  const cart = await getCart(true);
  if (!cart) throw new UserError("Your cart has expired.");
  const code = str(fd, "code").toUpperCase() || null;
  if (code && !(await rateLimit(`coupon:${(await clientIp()) ?? "x"}`, 20, 600))) throw new UserError("Too many attempts. Try again in a few minutes.");
  await db.update(schema.carts).set({ couponCode: code }).where(eq(schema.carts.id, cart.id));
  revalidatePath("/cart");
  revalidatePath("/checkout");
  return { ok: true, message: code ? "Code applied — see the total below." : "Code removed." };
});

const quoteSchema = z.object({
  fulfilment: z.enum(["COLLECTION", "LOCAL_DELIVERY", "COURIER"]),
  deliveryZoneId: z.string().uuid().nullable(),
});

/** Live totals for the checkout page; recalculated on the server every time. */
export async function quoteCheckout(input: { fulfilment: string; deliveryZoneId: string | null }) {
  const parsed = quoteSchema.safeParse(input);
  if (!parsed.success) return null;
  const cart = await getCart(false);
  if (!cart) return null;
  const commerce = await getSetting("commerce");
  const customerId = await currentCustomerId();
  const customer = customerId ? await db.query.customers.findFirst({ where: eq(schema.customers.id, customerId) }) : null;
  const priced = await priceCart(db, await cartLines(cart.id), {
    channel: "ONLINE",
    customerId,
    isWholesaleCustomer: !!customer?.isWholesale,
    couponCode: cart.couponCode,
    fulfilment: parsed.data.fulfilment,
    deliveryZoneId: parsed.data.deliveryZoneId,
    locationId: await getDefaultLocationId(),
    settings: commerce,
  });
  return {
    itemsCents: priced.lines.reduce((a, l) => a + l.lineSubtotalCents, 0),
    lines: priced.lines.map((l) => ({ name: `${l.productName}${l.variantName !== "Standard" ? ` (${l.variantName})` : ""}`, qty: l.qty, totalCents: l.lineSubtotalCents })),
    subtotalCents: priced.subtotalCents,
    discountCents: priced.discountCents,
    deliveryFeeCents: priced.deliveryFeeCents,
    taxCents: priced.taxCents,
    totalCents: priced.totalCents,
    taxInclusive: priced.taxInclusive,
    issues: priced.issues.filter((i) => !(i.code === "no_zone" && parsed.data.fulfilment === "COLLECTION")).map((i) => i.message),
    promotions: priced.appliedPromotions.map((p) => ({ name: p.name, amountCents: p.amountCents })),
    couponMessage: priced.couponMessage,
    etaText: priced.deliveryZone?.etaText ?? null,
  };
}

const checkoutSchema = z.object({
  name: z.string().trim().min(2, "Enter your name.").max(100),
  phone: z.string().trim().min(9, "Enter your phone number."),
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").or(z.literal("")),
  fulfilment: z.enum(["COLLECTION", "LOCAL_DELIVERY", "COURIER"]),
  deliveryZoneId: z.string().uuid().nullable(),
  county: z.string().trim().max(60),
  town: z.string().trim().max(80),
  area: z.string().trim().max(120),
  street: z.string().trim().max(160),
  landmark: z.string().trim().max(200),
  notes: z.string().trim().max(500),
  paymentMethod: z.enum(["MPESA", "CASH_ON_DELIVERY"]),
  expectedTotalCents: z.coerce.number().int().nonnegative(),
  idempotencyKey: z.string().uuid(),
  acceptPolicies: z.literal("on", { errorMap: () => ({ message: "Accept the terms and privacy notice to continue." }) }),
});

export const placeOrderAction = action(async (fd) => {
  const ip = await clientIp();
  if (!(await rateLimit(`checkout:${ip ?? "x"}`, 15, 600))) throw new UserError("Too many checkout attempts. Wait a few minutes and try again.");
  const d = checkoutSchema.parse({
    name: str(fd, "name"),
    phone: str(fd, "phone"),
    email: str(fd, "email"),
    fulfilment: str(fd, "fulfilment"),
    deliveryZoneId: optStr(fd, "deliveryZoneId"),
    county: str(fd, "county"),
    town: str(fd, "town"),
    area: str(fd, "area"),
    street: str(fd, "street"),
    landmark: str(fd, "landmark"),
    notes: str(fd, "notes"),
    paymentMethod: str(fd, "paymentMethod"),
    expectedTotalCents: str(fd, "expectedTotalCents"),
    idempotencyKey: str(fd, "idempotencyKey"),
    acceptPolicies: fd.get("acceptPolicies"),
  });
  const phone = normalizePhone(d.phone);
  if (!phone) throw new UserError("Check the phone number.", { phone: "Use a Kenyan mobile number like 0712 345 678." });
  const delivering = d.fulfilment !== "COLLECTION";
  if (delivering && (!d.county || !d.town)) throw new UserError("Enter the county and town for delivery.", { county: !d.county ? "Required." : "", town: !d.town ? "Required." : "" });
  const cart = await getCart(false);
  if (!cart) throw new UserError("Your cart is empty.");
  const lines = await cartLines(cart.id);
  if (!lines.length) throw new UserError("Your cart is empty.");
  const user = await getCurrentUser();
  const result = await placeOnlineOrder({
    idempotencyKey: d.idempotencyKey,
    userCustomerId: user ? await currentCustomerId() : null,
    contact: { name: d.name, phone, email: d.email || null },
    fulfilment: d.fulfilment,
    deliveryZoneId: delivering ? d.deliveryZoneId : null,
    address: delivering ? { county: d.county, town: d.town, area: d.area, street: d.street, landmark: d.landmark } : null,
    notes: d.notes || null,
    paymentMethod: d.paymentMethod,
    couponCode: cart.couponCode,
    lines,
    expectedTotalCents: d.expectedTotalCents,
    locationId: await getDefaultLocationId(),
  });
  // Clear the cart once the order exists.
  await db.delete(schema.cartItems).where(eq(schema.cartItems.cartId, cart.id));
  await db.update(schema.carts).set({ couponCode: null }).where(eq(schema.carts.id, cart.id));
  revalidatePath("/", "layout");
  const url = result.accessToken ? `/orders/${result.order.number}?key=${result.accessToken}&new=1` : user ? `/account/orders/${result.order.number}` : `/orders/lookup?n=${result.order.number}`;
  redirect(url);
});

export const newsletterAction = action(async (fd) => {
  const ip = await clientIp();
  if (!(await rateLimit(`newsletter:${ip ?? "x"}`, 5, 3600))) throw new UserError("Too many sign-ups from this connection. Try later.");
  const email = z.string().trim().toLowerCase().email().safeParse(str(fd, "email"));
  if (!email.success) throw new UserError("Enter a valid email address.", { email: "Invalid email." });
  if (fd.get("consent") !== "on") throw new UserError("Tick the box to agree to receive emails.");
  const consentText = "I agree to receive emails about new products and offers. I can unsubscribe at any time.";
  await db
    .insert(schema.newsletterSubscribers)
    .values({ email: email.data, consentText, source: "homepage", unsubscribeToken: randomToken(18) })
    .onConflictDoUpdate({ target: schema.newsletterSubscribers.email, set: { unsubscribedAt: null, consentAt: new Date(), consentText } });
  return { ok: true, message: "You're subscribed. Every email has a link to unsubscribe." };
});

export const guestOrderLookupAction = action(async (fd) => {
  const ip = await clientIp();
  if (!(await rateLimit(`lookup:${ip ?? "x"}`, 8, 900))) throw new UserError("Too many attempts. Wait 15 minutes and try again.");
  const number = str(fd, "number").toUpperCase();
  const phone = normalizePhone(str(fd, "phone"));
  const generic = { ok: true, message: "If those details match an order, we've sent a private link to the phone and email on the order." };
  if (!phone || !number) return generic;
  const order = await db.query.orders.findFirst({ where: and(eq(schema.orders.number, number), eq(schema.orders.contactPhone, phone)) });
  if (!order) return generic;
  const token = randomToken(24);
  await db.transaction(async (tx) => {
    await tx.update(schema.orders).set({ accessTokenHash: sha256(token) }).where(eq(schema.orders.id, order.id));
    await notify(tx, {
      event: "order.access_link",
      entityType: "order",
      entityId: order.id,
      dedupeSuffix: token.slice(0, 8),
      to: { customerId: order.customerId, name: order.contactName, email: order.contactEmail, phone: order.contactPhone },
      vars: { orderNumber: order.number, orderUrl: orderUrl(order, token) },
    });
  });
  return generic;
});

export const supportRequestAction = action(async (fd) => {
  const ip = await clientIp();
  if (!(await rateLimit(`support:${ip ?? "x"}`, 5, 3600))) throw new UserError("Too many requests. Try again later, or call us.");
  const name = str(fd, "name");
  const message = str(fd, "message");
  const subject = str(fd, "subject");
  const category = str(fd, "category") as (typeof schema.ticketCategory.enumValues)[number];
  if (name.length < 2 || message.length < 5 || subject.length < 3) throw new UserError("Fill in your name, a subject and your message.");
  if (!schema.ticketCategory.enumValues.includes(category)) throw new UserError("Choose what your message is about.");
  const phone = str(fd, "phone") ? normalizePhone(str(fd, "phone")) : null;
  const email = optStr(fd, "email");
  if (!phone && !email) throw new UserError("Give a phone number or email so we can reply.");
  const customerId = await currentCustomerId();
  let orderId: string | null = null;
  const orderNumber = optStr(fd, "orderNumber")?.toUpperCase();
  if (orderNumber) {
    const o = await db.query.orders.findFirst({ where: eq(schema.orders.number, orderNumber) });
    // Only link an order the requester can show is theirs.
    if (o && ((customerId && o.customerId === customerId) || (phone && o.contactPhone === phone))) orderId = o.id;
  }
  const productId = optStr(fd, "productId");
  const ticket = await db.transaction(async (tx) => {
    const number = await nextNumber(tx, "TICKET", 5);
    const [t] = await tx
      .insert(schema.supportTickets)
      .values({ number, customerId, orderId, contactName: name, contactPhone: phone, contactEmail: email, subject: subject.slice(0, 150), category, priority: category === "COMPLAINT" ? 1 : 2 })
      .returning();
    await tx.insert(schema.ticketMessages).values({ ticketId: t.id, fromCustomer: true, body: message.slice(0, 4000) + (productId ? `\n\n(Product id: ${productId})` : "") });
    await notifyStaff(tx, { event: "staff.ticket", entityType: "ticket", entityId: t.id, dedupeKey: `ticket:${t.id}`, vars: { ticketNumber: number, subject } });
    return t;
  });
  return { ok: true, message: `Thanks — we've received your message (${ticket.number}) and will reply by ${phone ? "phone/WhatsApp" : "email"}.` };
});

export const askQuestionAction = action(async (fd) => {
  const ip = await clientIp();
  if (!(await rateLimit(`question:${ip ?? "x"}`, 5, 3600))) throw new UserError("Too many questions from this connection. Try later.");
  const productId = str(fd, "productId");
  const question = str(fd, "question");
  const askerName = str(fd, "name") || "Customer";
  if (question.length < 8) throw new UserError("Write your question in a little more detail.");
  const p = await db.query.products.findFirst({ where: eq(schema.products.id, productId) });
  if (!p) throw new UserError("Product not found.");
  await db.transaction(async (tx) => {
    const [q] = await tx.insert(schema.productQuestions).values({ productId, customerId: await currentCustomerId(), askerName: askerName.slice(0, 60), question: question.slice(0, 1000) }).returning();
    await notifyStaff(tx, { event: "staff.feedback", entityType: "question", entityId: q.id, dedupeKey: `question:${q.id}`, vars: { kind: "question", summary: `${p.name}: ${question.slice(0, 80)}` } });
  });
  return { ok: true, message: "Thanks. Answers appear here once the shop has replied." };
});

export const reportReviewAction = action(async (fd) => {
  const ip = await clientIp();
  if (!(await rateLimit(`report:${ip ?? "x"}`, 10, 3600))) throw new UserError("Too many reports. Try later.");
  const reviewId = str(fd, "reviewId");
  const reason = str(fd, "reason") || "Inappropriate";
  const r = await db.query.reviews.findFirst({ where: eq(schema.reviews.id, reviewId) });
  if (!r) throw new UserError("Review not found.");
  const reporterHash = sha256(`${ip}:${reviewId}`);
  const already = await db.query.reviewReports.findFirst({ where: and(eq(schema.reviewReports.reviewId, reviewId), eq(schema.reviewReports.reporterHash, reporterHash)) });
  if (!already) {
    await db.transaction(async (tx) => {
      await tx.insert(schema.reviewReports).values({ reviewId, reason: reason.slice(0, 300), reporterHash });
      const n = await tx.execute<{ n: number }>(sql`select count(*)::int as n from review_reports where review_id = ${reviewId}`);
      // Three independent reports take a review down until staff look at it.
      if (Number(n.rows[0].n) >= 3 && r.status === "APPROVED") await tx.update(schema.reviews).set({ status: "FLAGGED" }).where(eq(schema.reviews.id, reviewId));
      await notifyStaff(tx, { event: "staff.feedback", entityType: "review", entityId: reviewId, dedupeKey: `review_report:${reviewId}:${reporterHash.slice(0, 8)}`, vars: { kind: "review report", summary: reason.slice(0, 80) } });
    });
  }
  return { ok: true, message: "Thanks, we'll take a look." };
});

