import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { db, schema, type Tx } from "@/db";
import { audit } from "@/lib/audit";
import { randomToken, sha256 } from "@/lib/crypto";
import { issueDocument } from "@/lib/documents";
import { applyMovement, commitSale, expandBundles, InsufficientStockError, releaseReservation, reserveStock } from "@/lib/inventory";
import { formatKES } from "@/lib/money";
import { notify, notifyStaff } from "@/lib/notifications";
import { priceCart, type PricingIssue, type PricingResult } from "@/lib/pricing";
import { nextNumber } from "@/lib/sequence";
import { getAllSettings } from "@/lib/settings";

export type OrderStatus = (typeof schema.orderStatus.enumValues)[number];
export type PaymentMethod = (typeof schema.paymentMethod.enumValues)[number];
type Order = typeof schema.orders.$inferSelect;

export const STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING: "Pending",
  AWAITING_PAYMENT: "Awaiting payment",
  PAID: "Paid",
  PROCESSING: "Processing",
  READY_FOR_COLLECTION: "Ready for collection",
  DISPATCHED: "Dispatched",
  DELIVERED: "Delivered",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  PARTIALLY_REFUNDED: "Partially refunded",
  REFUNDED: "Refunded",
};

export const PAYMENT_STATUS_LABEL: Record<string, string> = {
  UNPAID: "Unpaid",
  PENDING: "Payment pending",
  PARTIALLY_PAID: "Part paid",
  PAID: "Paid",
  FAILED: "Payment failed",
  PARTIALLY_REFUNDED: "Part refunded",
  REFUNDED: "Refunded",
};

/**
 * Allowed manual status changes. Payment- and refund-driven statuses (PAID, *_REFUNDED) are set by
 * those workflows, not chosen directly.
 */
export const TRANSITIONS: Partial<Record<OrderStatus, OrderStatus[]>> = {
  PENDING: ["PROCESSING", "CANCELLED"],
  AWAITING_PAYMENT: ["CANCELLED"],
  PAID: ["PROCESSING", "READY_FOR_COLLECTION", "DISPATCHED", "COMPLETED"],
  PROCESSING: ["READY_FOR_COLLECTION", "DISPATCHED", "COMPLETED", "CANCELLED"],
  READY_FOR_COLLECTION: ["COMPLETED", "PROCESSING", "CANCELLED"],
  DISPATCHED: ["DELIVERED", "PROCESSING"],
  DELIVERED: ["COMPLETED"],
};

export class OrderError extends Error {
  constructor(
    message: string,
    public issues: PricingIssue[] = [],
  ) {
    super(message);
    this.name = "OrderError";
  }
}

export async function lockOrder(tx: Tx, orderId: string): Promise<Order> {
  const rows = await tx.select().from(schema.orders).where(eq(schema.orders.id, orderId)).for("update");
  if (!rows[0]) throw new OrderError("Order not found.");
  return rows[0];
}

export async function addOrderEvent(
  tx: Tx,
  e: { orderId: string; type: string; message: string; userId?: string | null; fromStatus?: OrderStatus | null; toStatus?: OrderStatus | null },
) {
  await tx.insert(schema.orderEvents).values({
    orderId: e.orderId,
    type: e.type,
    message: e.message,
    userId: e.userId ?? null,
    fromStatus: e.fromStatus ?? null,
    toStatus: e.toStatus ?? null,
  });
}

export function orderUrl(order: { number: string }, accessToken?: string | null) {
  const base = process.env.APP_URL ?? "http://localhost:3000";
  return accessToken ? `${base}/orders/${order.number}?key=${accessToken}` : `${base}/account/orders/${order.number}`;
}

export async function findOrCreateGuestCustomer(tx: Tx, c: { name: string; phone: string | null; email: string | null }) {
  // Guests are matched only to other guest records (never to a registered account), so typing someone
  // else's phone number at checkout can't attach an order to their account.
  if (c.phone) {
    const existing = await tx.query.customers.findFirst({
      where: and(eq(schema.customers.phone, c.phone), isNull(schema.customers.userId), isNull(schema.customers.anonymizedAt)),
    });
    if (existing) {
      if (c.email && !existing.email) await tx.update(schema.customers).set({ email: c.email }).where(eq(schema.customers.id, existing.id));
      return existing.id;
    }
  }
  const [row] = await tx.insert(schema.customers).values({ name: c.name, phone: c.phone, email: c.email }).returning({ id: schema.customers.id });
  return row.id;
}

/** Atomically count a promotion use; fails if its usage limit was reached by a concurrent order. */
async function redeemPromotions(tx: Tx, orderId: string, customerId: string | null, priced: PricingResult) {
  for (const p of priced.appliedPromotions) {
    const res = await tx.execute(sql`
      update promotions set usage_count = usage_count + 1
       where id = ${p.id} and (usage_limit is null or usage_count < usage_limit) returning id`);
    if (res.rows.length === 0) throw new OrderError(`The offer "${p.name}" has just reached its limit. Review your cart and try again.`);
    await tx.insert(schema.promotionRedemptions).values({ promotionId: p.id, orderId, customerId, amountCents: p.amountCents });
  }
}

export type CheckoutInput = {
  idempotencyKey: string;
  userCustomerId: string | null; // signed-in customer, if any
  contact: { name: string; phone: string; email: string | null };
  fulfilment: "COLLECTION" | "LOCAL_DELIVERY" | "COURIER";
  deliveryZoneId: string | null;
  address: { county: string; town: string; area?: string; street?: string; landmark?: string } | null;
  notes: string | null;
  paymentMethod: "MPESA" | "CASH_ON_DELIVERY";
  couponCode: string | null;
  lines: { variantId: string; qty: number }[];
  expectedTotalCents: number;
  locationId: string;
};

/**
 * Place an online order. Prices, discounts, delivery and tax are recalculated here. If anything differs
 * from what the customer saw (price change, stock, expired code), the order is refused and the customer
 * is asked to review their cart, rather than charging a different amount.
 */
export async function placeOnlineOrder(input: CheckoutInput) {
  return db.transaction(async (tx) => {
    const dupe = await tx.query.orders.findFirst({ where: eq(schema.orders.idempotencyKey, input.idempotencyKey) });
    if (dupe) return { order: dupe, accessToken: null as string | null, duplicate: true };

    const { commerce } = await getAllSettings(tx);
    if (input.paymentMethod === "CASH_ON_DELIVERY" && !commerce.cashOnDelivery) throw new OrderError("Cash on delivery isn't available.");
    if (input.fulfilment === "COLLECTION" && !commerce.collectionEnabled) throw new OrderError("Store collection isn't available.");
    if (input.fulfilment !== "COLLECTION" && !input.address) throw new OrderError("Enter a delivery address.");

    let customerId = input.userCustomerId;
    let isWholesale = false;
    if (customerId) {
      const c = await tx.query.customers.findFirst({ where: eq(schema.customers.id, customerId) });
      isWholesale = !!c?.isWholesale;
    } else {
      if (!commerce.guestCheckout) throw new OrderError("Please sign in to place an order.");
      customerId = await findOrCreateGuestCustomer(tx, input.contact);
    }

    const priced = await priceCart(tx, input.lines, {
      channel: "ONLINE",
      customerId,
      isWholesaleCustomer: isWholesale,
      couponCode: input.couponCode,
      fulfilment: input.fulfilment,
      deliveryZoneId: input.deliveryZoneId,
      locationId: input.locationId,
      settings: commerce,
    });
    if (priced.lines.length === 0) throw new OrderError("Your cart is empty.", priced.issues);
    const blocking = priced.issues.filter((i) => i.code !== "no_zone" || input.fulfilment !== "COLLECTION");
    if (blocking.length) throw new OrderError("Some items in your cart changed. Review your cart and try again.", blocking);
    if (priced.totalCents !== input.expectedTotalCents) {
      throw new OrderError(`The total changed to ${formatKES(priced.totalCents)}. Review your order and confirm again.`);
    }
    if (input.couponCode && priced.couponMessage) throw new OrderError(priced.couponMessage);

    const number = await nextNumber(tx, "ORDER");
    const accessToken = randomToken(24);
    const isCod = input.paymentMethod === "CASH_ON_DELIVERY";
    const [order] = await tx
      .insert(schema.orders)
      .values({
        number,
        idempotencyKey: input.idempotencyKey,
        source: "ONLINE",
        status: isCod ? "PROCESSING" : "AWAITING_PAYMENT",
        paymentStatus: "UNPAID",
        fulfilmentMethod: input.fulfilment,
        customerId,
        contactName: input.contact.name,
        contactPhone: input.contact.phone,
        contactEmail: input.contact.email,
        deliveryAddress: input.address,
        deliveryZoneId: priced.deliveryZone?.id ?? null,
        notes: input.notes,
        isWholesale,
        taxInclusive: priced.taxInclusive,
        subtotalCents: priced.subtotalCents,
        discountCents: priced.orderDiscountCents,
        deliveryFeeCents: priced.deliveryFeeCents,
        taxCents: priced.taxCents,
        totalCents: priced.totalCents,
        couponCode: input.couponCode?.toUpperCase() ?? null,
        paymentMethodChosen: input.paymentMethod,
        locationId: input.locationId,
        stockState: "RESERVED",
        reservationExpiresAt: isCod ? null : new Date(Date.now() + commerce.reservationMinutes * 60_000),
        accessTokenHash: sha256(accessToken),
        policyAcceptedAt: new Date(),
        isDemo: priced.lines.some((l) => l.isDemo),
      })
      .returning();

    await tx.insert(schema.orderItems).values(
      priced.lines.map((l) => ({
        orderId: order.id,
        variantId: l.variantId,
        productName: l.productName,
        variantName: l.variantName,
        sku: l.sku,
        qty: l.qty,
        unitPriceCents: l.unitPriceCents,
        listPriceCents: l.listPriceCents,
        discountCents: l.lineDiscountCents,
        lineTotalCents: l.lineTotalCents,
        taxCents: l.taxCents,
        unitCostCents: l.unitCostCents,
      })),
    );

    try {
      await reserveStock(
        tx,
        input.locationId,
        priced.lines.map((l) => ({ variantId: l.variantId, qty: l.qty })),
        { orderId: order.id },
      );
    } catch (e) {
      if (e instanceof InsufficientStockError) throw new OrderError("An item just sold out. Review your cart and try again.");
      throw e;
    }
    await redeemPromotions(tx, order.id, customerId, priced);
    if (input.fulfilment !== "COLLECTION") {
      await tx.insert(schema.deliveries).values({ orderId: order.id, zoneId: priced.deliveryZone?.id ?? null });
    }
    await addOrderEvent(tx, { orderId: order.id, type: "status_change", toStatus: order.status, message: `Order placed online (${isCod ? "cash on delivery" : "M-Pesa"}).` });
    if (input.userCustomerId) {
      await tx.delete(schema.carts).where(eq(schema.carts.customerId, input.userCustomerId));
    }

    await notify(tx, {
      event: "order.placed",
      entityType: "order",
      entityId: order.id,
      to: { customerId, name: input.contact.name, email: input.contact.email, phone: input.contact.phone },
      vars: {
        orderNumber: number,
        total: formatKES(order.totalCents),
        paymentLine: isCod ? "Pay when you receive your order." : "Complete payment with the M-Pesa prompt on your phone.",
        orderUrl: orderUrl(order, accessToken),
      },
    });
    await notifyStaff(tx, {
      event: "staff.new_order",
      entityType: "order",
      entityId: order.id,
      dedupeKey: `new_order:${order.id}`,
      vars: { orderNumber: number, total: formatKES(order.totalCents), name: input.contact.name },
    });
    return { order, accessToken, duplicate: false };
  });
}

function derivePaymentStatus(o: { totalCents: number; amountPaidCents: number; refundedCents: number }) {
  if (o.refundedCents > 0) return o.refundedCents >= o.amountPaidCents ? "REFUNDED" : "PARTIALLY_REFUNDED";
  if (o.amountPaidCents <= 0) return "UNPAID";
  if (o.amountPaidCents < o.totalCents) return "PARTIALLY_PAID";
  return "PAID";
}

export class DuplicatePaymentError extends Error {
  constructor() {
    super("That payment reference has already been recorded.");
    this.name = "DuplicatePaymentError";
  }
}

/**
 * Record money received against an order. The single place that marks orders paid.
 * Callers must have verified the payment (provider-confirmed, or recorded by authorised staff).
 */
export async function recordPayment(
  tx: Tx,
  p: {
    orderId: string;
    method: PaymentMethod;
    amountCents: number;
    reference: string | null;
    attemptId?: string | null;
    userId?: string | null;
    posSessionId?: string | null;
    note?: string | null;
    receivedAt?: Date;
    issueReceipt?: boolean;
    cashTenderedCents?: number;
    changeCents?: number;
  },
) {
  if (!Number.isInteger(p.amountCents) || p.amountCents <= 0) throw new Error("Payment amount must be positive.");
  const order = await lockOrder(tx, p.orderId);
  const ref = p.reference?.trim().toUpperCase() || null;
  if (ref) {
    const clash = await tx.query.payments.findFirst({ where: and(eq(schema.payments.method, p.method), eq(schema.payments.reference, ref)) });
    if (clash) throw new DuplicatePaymentError();
  }
  const [payment] = await tx
    .insert(schema.payments)
    .values({
      orderId: order.id,
      method: p.method,
      amountCents: p.amountCents,
      reference: ref,
      attemptId: p.attemptId ?? null,
      recordedById: p.userId ?? null,
      posSessionId: p.posSessionId ?? null,
      note: p.note ?? null,
      receivedAt: p.receivedAt ?? new Date(),
    })
    .returning();

  const amountPaid = order.amountPaidCents + p.amountCents;
  const paymentStatus = derivePaymentStatus({ ...order, amountPaidCents: amountPaid });
  const fullyPaid = amountPaid >= order.totalCents;
  let status: OrderStatus = order.status;
  let stockState = order.stockState;
  const lines = await tx
    .select({ variantId: schema.orderItems.variantId, qty: schema.orderItems.qty })
    .from(schema.orderItems)
    .where(eq(schema.orderItems.orderId, order.id));

  if (fullyPaid) {
    if (order.status === "PENDING" || order.status === "AWAITING_PAYMENT") status = order.source === "POS" ? "COMPLETED" : "PAID";
    if (stockState === "RESERVED") {
      await commitSale(tx, order.locationId, lines, { orderId: order.id, userId: p.userId, fromReservation: true });
      stockState = "COMMITTED";
    } else if (stockState === "NONE" || stockState === "RELEASED") {
      // Late payment after the reservation expired: try to take stock now.
      try {
        await commitSale(tx, order.locationId, lines, { orderId: order.id, userId: p.userId, fromReservation: false });
        stockState = "COMMITTED";
        if (order.status === "CANCELLED") status = "PAID";
      } catch (e) {
        if (!(e instanceof InsufficientStockError)) throw e;
        await notifyStaff(tx, {
          event: "staff.payment_review",
          entityType: "order",
          entityId: order.id,
          dedupeKey: `late_payment:${payment.id}`,
          vars: { orderNumber: order.number, reason: "payment arrived after the order expired and stock is no longer available — refund or restock" },
        });
      }
    }
  }

  await tx
    .update(schema.orders)
    .set({
      amountPaidCents: amountPaid,
      paymentStatus,
      status,
      stockState,
      paidAt: fullyPaid && !order.paidAt ? new Date() : order.paidAt,
      completedAt: status === "COMPLETED" && !order.completedAt ? new Date() : order.completedAt,
      reservationExpiresAt: fullyPaid ? null : order.reservationExpiresAt,
    })
    .where(eq(schema.orders.id, order.id));
  await addOrderEvent(tx, {
    orderId: order.id,
    type: "payment",
    userId: p.userId,
    fromStatus: order.status,
    toStatus: status !== order.status ? status : null,
    message: `${formatKES(p.amountCents)} received by ${p.method}${ref ? ` (${ref})` : ""}.`,
  });
  if (p.method !== "MPESA" || !p.attemptId) {
    await audit({ userId: p.userId, action: "payment.record", entityType: "order", entityId: order.id, details: { method: p.method, amountCents: p.amountCents, reference: ref } }, tx);
  }

  let receipt: typeof schema.documents.$inferSelect | null = null;
  if (fullyPaid && p.issueReceipt !== false) {
    receipt = await issueDocument(tx, { type: "RECEIPT", orderId: order.id, cashTenderedCents: p.cashTenderedCents, changeCents: p.changeCents });
  }
  if (order.source === "ONLINE") {
    await notify(tx, {
      event: "payment.received",
      entityType: "payment",
      entityId: payment.id,
      to: { customerId: order.customerId, name: order.contactName, email: order.contactEmail, phone: order.contactPhone },
      vars: {
        orderNumber: order.number,
        amount: formatKES(p.amountCents),
        reference: ref ?? "—",
        receiptUrl: receipt ? `${process.env.APP_URL ?? ""}/documents/${receipt.id}` : orderUrl(order),
      },
    });
  }
  return { payment, receipt, fullyPaid, status };
}

/** Manual status change by staff, with validation and the stock/notification side effects. */
export async function transitionOrder(
  orderId: string,
  to: OrderStatus,
  actor: { userId: string; ip?: string | null },
  opts: { note?: string; returnCondition?: "RESELLABLE" | "DAMAGED" | "NOT_RETURNED" } = {},
) {
  return db.transaction(async (tx) => {
    const order = await lockOrder(tx, orderId);
    const allowed = TRANSITIONS[order.status] ?? [];
    if (!allowed.includes(to)) {
      throw new OrderError(`An order that is ${STATUS_LABEL[order.status].toLowerCase()} can't be moved to ${STATUS_LABEL[to].toLowerCase()}.`);
    }
    const netPaid = order.amountPaidCents - order.refundedCents;
    const lines = await tx
      .select({ variantId: schema.orderItems.variantId, qty: schema.orderItems.qty })
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, order.id));
    let stockState = order.stockState;
    const patch: Partial<typeof schema.orders.$inferInsert> = { status: to };

    if (to === "CANCELLED") {
      if (netPaid > 0) throw new OrderError("This order has payments. Issue a refund first; the order is closed by the refund.");
      if (stockState === "RESERVED") {
        await releaseReservation(tx, order.locationId, lines, { orderId: order.id, userId: actor.userId, reason: "Order cancelled" });
        stockState = "RELEASED";
      } else if (stockState === "COMMITTED") {
        const cond = opts.returnCondition;
        if (!cond) throw new OrderError("Say whether the goods came back resellable, damaged, or not at all.");
        for (const l of await expandBundles(tx, lines)) {
          if (cond === "RESELLABLE")
            await applyMovement(tx, { variantId: l.variantId, locationId: order.locationId, type: "CUSTOMER_RETURN", onHandDelta: l.qty, reason: "Cancelled order returned", refType: "ORDER", refId: order.id, userId: actor.userId });
          else if (cond === "DAMAGED")
            await applyMovement(tx, { variantId: l.variantId, locationId: order.locationId, type: "QUARANTINE_IN", quarantineDelta: l.qty, reason: "Cancelled order returned damaged", refType: "ORDER", refId: order.id, userId: actor.userId });
        }
        stockState = "RELEASED";
      }
      await tx.execute(sql`update promotions p set usage_count = greatest(usage_count - 1, 0)
                           from promotion_redemptions r where r.promotion_id = p.id and r.order_id = ${order.id}`);
      patch.cancelledAt = new Date();
    }
    if ((to === "DISPATCHED" || to === "COMPLETED") && stockState === "RESERVED") {
      // Cash-on-delivery goods leave the shop now.
      await commitSale(tx, order.locationId, lines, { orderId: order.id, userId: actor.userId, fromReservation: true });
      stockState = "COMMITTED";
    }
    if (to === "COMPLETED") {
      if (order.amountPaidCents < order.totalCents) throw new OrderError("Record the payment before completing this order.");
      patch.completedAt = new Date();
    }
    patch.stockState = stockState;
    await tx.update(schema.orders).set(patch).where(eq(schema.orders.id, order.id));

    if (order.fulfilmentMethod === "LOCAL_DELIVERY" || order.fulfilmentMethod === "COURIER") {
      if (to === "DISPATCHED")
        await tx.update(schema.deliveries).set({ status: "DISPATCHED", dispatchedAt: new Date() }).where(eq(schema.deliveries.orderId, order.id));
      if (to === "DELIVERED")
        await tx.update(schema.deliveries).set({ status: "DELIVERED", deliveredAt: new Date() }).where(eq(schema.deliveries.orderId, order.id));
    }
    await addOrderEvent(tx, {
      orderId: order.id,
      type: "status_change",
      userId: actor.userId,
      fromStatus: order.status,
      toStatus: to,
      message: `Status changed to ${STATUS_LABEL[to]}${opts.note ? `: ${opts.note}` : ""}.`,
    });
    await audit({ userId: actor.userId, action: "order.status", entityType: "order", entityId: order.id, details: { from: order.status, to }, ip: actor.ip }, tx);

    if (order.source === "ONLINE") {
      const to_ = { customerId: order.customerId, name: order.contactName, email: order.contactEmail, phone: order.contactPhone };
      if (to === "CANCELLED") {
        await notify(tx, { event: "order.cancelled", entityType: "order", entityId: order.id, to: to_, vars: { orderNumber: order.number, reason: opts.note ?? "" } });
      } else if (["READY_FOR_COLLECTION", "DISPATCHED", "DELIVERED"].includes(to)) {
        const d = await tx.query.deliveries.findFirst({ where: eq(schema.deliveries.orderId, order.id) });
        const extra =
          to === "DISPATCHED" && d
            ? [d.courierName && `Courier: ${d.courierName}`, d.trackingRef && `Tracking: ${d.trackingRef}`, d.riderName && `Rider: ${d.riderName}`].filter(Boolean).join(". ")
            : "";
        await notify(tx, {
          event: "order.status",
          entityType: "order",
          entityId: order.id,
          dedupeSuffix: to,
          to: to_,
          vars: { orderNumber: order.number, statusLabel: STATUS_LABEL[to].toLowerCase(), extra, orderUrl: orderUrl(order) },
        });
      }
    }
    return { ...order, ...patch };
  });
}

/** Release stock held by unpaid online orders whose payment window has passed. Run by the worker. */
export async function expireUnpaidOrders(now = new Date()) {
  const due = await db
    .select({ id: schema.orders.id })
    .from(schema.orders)
    .where(and(eq(schema.orders.status, "AWAITING_PAYMENT"), eq(schema.orders.stockState, "RESERVED"), lt(schema.orders.reservationExpiresAt, now)))
    .limit(100);
  let expired = 0;
  for (const { id } of due) {
    await db.transaction(async (tx) => {
      const order = await lockOrder(tx, id);
      if (order.status !== "AWAITING_PAYMENT" || order.stockState !== "RESERVED" || order.amountPaidCents > 0) return;
      // Give an in-flight M-Pesa prompt a few more minutes before releasing stock.
      const pending = await tx.query.paymentAttempts.findFirst({
        where: and(
          eq(schema.paymentAttempts.orderId, id),
          inArray(schema.paymentAttempts.status, ["INITIATED", "PENDING"]),
          sql`${schema.paymentAttempts.createdAt} > now() - interval '5 minutes'`,
        ),
      });
      if (pending) return;
      const lines = await tx.select({ variantId: schema.orderItems.variantId, qty: schema.orderItems.qty }).from(schema.orderItems).where(eq(schema.orderItems.orderId, id));
      await releaseReservation(tx, order.locationId, lines, { orderId: id, reason: "Payment window expired" });
      await tx.update(schema.orders).set({ status: "CANCELLED", stockState: "RELEASED", cancelledAt: now }).where(eq(schema.orders.id, id));
      await tx.execute(sql`update promotions p set usage_count = greatest(usage_count - 1, 0)
                           from promotion_redemptions r where r.promotion_id = p.id and r.order_id = ${id}`);
      await addOrderEvent(tx, { orderId: id, type: "status_change", fromStatus: "AWAITING_PAYMENT", toStatus: "CANCELLED", message: "Cancelled automatically: payment not received in time. Stock released." });
      await notify(tx, {
        event: "order.cancelled",
        entityType: "order",
        entityId: id,
        to: { customerId: order.customerId, name: order.contactName, email: order.contactEmail, phone: order.contactPhone },
        vars: { orderNumber: order.number, reason: "We didn't receive payment in time, so the items were released. You're welcome to order again." },
      });
      expired++;
    });
  }
  return expired;
}
