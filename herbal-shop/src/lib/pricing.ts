import { and, eq, inArray, sql } from "drizzle-orm";
import { schema, type Executor } from "@/db";
import { allocateProportionally, floorToShilling, roundToShilling } from "@/lib/money";
import type { CommerceSettings } from "@/lib/settings";
import { availability } from "@/lib/inventory";

/**
 * Server-side pricing. Browser-supplied prices and totals are never trusted; every cart view,
 * checkout and POS sale re-runs this against the database.
 *
 * Order of operations
 *   1. unit price per line (retail, or wholesale for approved wholesale customers at/above min qty)
 *   2. optional authorised price override (POS only)
 *   3. promotions: stackable ones combine; a non-stackable promotion is used alone; the better outcome wins
 *   4. delivery fee from the zone (free-over threshold / free-delivery promotion)
 *   5. tax: computed per line on the discounted amount; inclusive prices extract it, exclusive add it
 * All money is integer cents; discounts are floored and exclusive tax rounded to whole shillings.
 */

export type PriceLineInput = {
  variantId: string;
  qty: number;
  /** POS only: price override per unit, already permission-checked by the caller. */
  overrideUnitCents?: number | null;
};

export type PricingContext = {
  channel: "ONLINE" | "POS";
  customerId?: string | null;
  isWholesaleCustomer?: boolean;
  couponCode?: string | null;
  fulfilment?: "COLLECTION" | "LOCAL_DELIVERY" | "COURIER" | "WALK_IN";
  deliveryZoneId?: string | null;
  /** POS only: manual order discount in cents, permission-checked by the caller. */
  manualDiscountCents?: number;
  locationId: string;
  settings: CommerceSettings;
  now?: Date;
};

export type PricedLine = {
  variantId: string;
  productId: string;
  productName: string;
  variantName: string;
  sku: string | null;
  slug: string;
  qty: number;
  listPriceCents: number;
  unitPriceCents: number;
  isWholesalePrice: boolean;
  overridden: boolean;
  lineSubtotalCents: number; // qty * unit
  lineDiscountCents: number; // product/category promotions
  lineTotalCents: number; // after line discounts
  orderDiscountShareCents: number;
  taxCents: number;
  taxCategory: "STANDARD" | "ZERO_RATED" | "EXEMPT";
  unitCostCents: number | null;
  available: number;
  categoryId: string | null;
  isDemo: boolean;
};

export type PricingIssue = { variantId?: string; code: string; message: string };

export type PricingResult = {
  lines: PricedLine[];
  issues: PricingIssue[];
  subtotalCents: number; // after line discounts
  discountCents: number; // line + order discounts combined (for display/reporting)
  orderDiscountCents: number;
  deliveryFeeCents: number;
  taxCents: number;
  totalCents: number;
  appliedPromotions: { id: string; name: string; code: string | null; amountCents: number }[];
  couponMessage: string | null;
  deliveryZone: { id: string; name: string; etaText: string | null } | null;
  taxInclusive: boolean;
};

type Promo = typeof schema.promotions.$inferSelect;

function promoActive(p: Promo, now: Date) {
  if (!p.isActive) return false;
  if (p.startsAt && p.startsAt > now) return false;
  if (p.endsAt && p.endsAt < now) return false;
  if (p.usageLimit != null && p.usageCount >= p.usageLimit) return false;
  return true;
}

async function promoEligibleForCustomer(exec: Executor, p: Promo, customerId: string | null | undefined): Promise<string | null> {
  if (p.customerId && p.customerId !== customerId) return "This code isn't available on your account.";
  if (p.perCustomerLimit != null) {
    if (!customerId) return "Sign in to use this code.";
    const used = await exec.execute<{ n: number }>(
      sql`select count(*)::int as n from promotion_redemptions r join orders o on o.id = r.order_id
          where r.promotion_id = ${p.id} and r.customer_id = ${customerId} and o.status <> 'CANCELLED'`,
    );
    if (Number(used.rows[0].n) >= p.perCustomerLimit) return "You've already used this code the maximum number of times.";
  }
  return null;
}

/** Discount a promotion gives on the given lines, as {perLine, order, freeDelivery}. */
function evaluatePromo(p: Promo, lines: PricedLine[]) {
  const eligible = lines.map((l) =>
    p.scope === "ORDER" ? true : p.scope === "PRODUCTS" ? p.productIds.includes(l.productId) : !!l.categoryId && p.categoryIds.includes(l.categoryId),
  );
  const base = lines.map((l, i) => (eligible[i] ? l.lineSubtotalCents : 0));
  const baseSum = base.reduce((a, b) => a + b, 0);
  if (p.type === "FREE_DELIVERY") return { perLine: lines.map(() => 0), order: 0, freeDelivery: baseSum > 0 };
  let amount = p.type === "PERCENT" ? floorToShilling(Math.floor((baseSum * Math.min(100, Math.max(0, p.value))) / 100)) : Math.min(p.value, baseSum);
  amount = Math.max(0, Math.min(amount, baseSum));
  if (p.scope === "ORDER") return { perLine: lines.map(() => 0), order: amount, freeDelivery: false };
  return { perLine: allocateProportionally(amount, base), order: 0, freeDelivery: false };
}

export async function priceCart(exec: Executor, input: PriceLineInput[], ctx: PricingContext): Promise<PricingResult> {
  const now = ctx.now ?? new Date();
  const issues: PricingIssue[] = [];
  const merged = new Map<string, PriceLineInput>();
  for (const l of input) {
    if (!Number.isInteger(l.qty) || l.qty <= 0) continue;
    const prev = merged.get(l.variantId);
    merged.set(l.variantId, prev ? { ...prev, qty: prev.qty + l.qty } : { ...l });
  }
  const ids = [...merged.keys()];
  const rows = ids.length
    ? await exec
        .select({ v: schema.productVariants, p: schema.products })
        .from(schema.productVariants)
        .innerJoin(schema.products, eq(schema.products.id, schema.productVariants.productId))
        .where(inArray(schema.productVariants.id, ids))
    : [];
  const avail = await availability(
    exec,
    rows.map((r) => r.v.id),
    ctx.locationId,
  );

  const lines: PricedLine[] = [];
  for (const id of ids) {
    const inp = merged.get(id)!;
    const r = rows.find((x) => x.v.id === id);
    if (!r) {
      issues.push({ variantId: id, code: "missing", message: "An item in your cart is no longer available and was removed." });
      continue;
    }
    const sellableOnline =
      r.p.status === "PUBLISHED" && (!r.p.publishAt || r.p.publishAt <= now) && r.v.isActive && !r.p.archivedAt;
    const sellable = ctx.channel === "POS" ? r.p.status !== "ARCHIVED" && !r.p.needsReview && r.v.isActive : sellableOnline;
    if (!sellable) {
      issues.push({ variantId: id, code: "unavailable", message: `${r.p.name} is no longer for sale and was removed.` });
      continue;
    }
    if (r.v.priceCents == null && inp.overrideUnitCents == null) {
      issues.push({ variantId: id, code: "no_price", message: `${r.p.name} has no price set yet, so it can't be sold.` });
      continue;
    }
    const available = avail.get(id) ?? 0;
    let qty = inp.qty;
    if (qty > available) {
      if (available <= 0) {
        issues.push({ variantId: id, code: "out_of_stock", message: `${r.p.name} (${r.v.name}) is out of stock.` });
        continue;
      }
      issues.push({ variantId: id, code: "qty_reduced", message: `Only ${available} of ${r.p.name} (${r.v.name}) available; quantity reduced.` });
      qty = available;
    }
    const list = r.v.priceCents ?? 0;
    const useWholesale =
      ctx.settings.wholesaleEnabled && !!ctx.isWholesaleCustomer && r.v.wholesalePriceCents != null && qty >= r.v.wholesaleMinQty;
    let unit = useWholesale ? r.v.wholesalePriceCents! : list;
    const overridden = inp.overrideUnitCents != null && ctx.channel === "POS";
    if (overridden) unit = inp.overrideUnitCents!;
    lines.push({
      variantId: id,
      productId: r.p.id,
      productName: r.p.name,
      variantName: r.v.name,
      sku: r.v.sku,
      slug: r.p.slug,
      qty,
      listPriceCents: list,
      unitPriceCents: unit,
      isWholesalePrice: useWholesale && !overridden,
      overridden,
      lineSubtotalCents: unit * qty,
      lineDiscountCents: 0,
      lineTotalCents: unit * qty,
      orderDiscountShareCents: 0,
      taxCents: 0,
      taxCategory: r.p.taxCategory,
      unitCostCents: r.v.avgCostCents,
      available,
      categoryId: r.p.categoryId,
      isDemo: r.p.isDemo,
    });
  }

  // ── Promotions ──
  const promosAll = await exec.select().from(schema.promotions).where(eq(schema.promotions.isActive, true));
  const code = ctx.couponCode?.trim().toUpperCase() || null;
  let couponMessage: string | null = null;
  const candidates: Promo[] = [];
  for (const p of promosAll) {
    if (!promoActive(p, now)) {
      if (code && p.code === code) couponMessage = "This code has expired or reached its usage limit.";
      continue;
    }
    if (p.code && p.code !== code) continue;
    if (ctx.isWholesaleCustomer && lines.some((l) => l.isWholesalePrice)) {
      // Promotions don't stack on wholesale prices.
      if (p.code === code) couponMessage = "Codes can't be combined with wholesale pricing.";
      continue;
    }
    const subtotal = lines.reduce((a, l) => a + l.lineSubtotalCents, 0);
    if (p.minOrderCents != null && subtotal < p.minOrderCents) {
      if (p.code === code) couponMessage = `This code needs a minimum order of KES ${(p.minOrderCents / 100).toLocaleString("en-KE")}.`;
      continue;
    }
    const custErr = await promoEligibleForCustomer(exec, p, ctx.customerId);
    if (custErr) {
      if (p.code === code) couponMessage = custErr;
      continue;
    }
    candidates.push(p);
  }
  if (code && !promosAll.some((p) => p.code === code)) couponMessage = "We don't recognise that code.";

  const evaluated = candidates.map((p) => ({ p, e: evaluatePromo(p, lines) }));
  const value = (xs: typeof evaluated, fee: number) =>
    xs.reduce((a, x) => a + x.e.order + x.e.perLine.reduce((s, n) => s + n, 0) + (x.e.freeDelivery ? fee : 0), 0);

  // Delivery fee before promotions.
  let deliveryZone: PricingResult["deliveryZone"] = null;
  let baseDeliveryFee = 0;
  if (ctx.fulfilment === "LOCAL_DELIVERY" || ctx.fulfilment === "COURIER") {
    const zone = ctx.deliveryZoneId
      ? await exec.query.deliveryZones.findFirst({
          where: and(eq(schema.deliveryZones.id, ctx.deliveryZoneId), eq(schema.deliveryZones.isActive, true)),
        })
      : null;
    if (!zone) issues.push({ code: "no_zone", message: "Choose a delivery area to see the delivery fee." });
    else {
      deliveryZone = { id: zone.id, name: zone.name, etaText: zone.etaText };
      const sub = lines.reduce((a, l) => a + l.lineSubtotalCents, 0);
      baseDeliveryFee = zone.freeOverCents != null && sub >= zone.freeOverCents ? 0 : zone.feeCents;
    }
  }

  const stackables = evaluated.filter((x) => x.p.stackable);
  const exclusives = evaluated.filter((x) => !x.p.stackable);
  let chosen = stackables;
  let bestValue = value(stackables, baseDeliveryFee);
  for (const x of exclusives) {
    const v = value([x], baseDeliveryFee);
    if (v > bestValue) {
      chosen = [x];
      bestValue = v;
    }
  }
  if (code && candidates.some((p) => p.code === code) && !chosen.some((x) => x.p.code === code)) {
    couponMessage = "A better offer is already applied to this order, so the code wasn't combined with it.";
  }

  const appliedPromotions: PricingResult["appliedPromotions"] = [];
  let orderDiscount = 0;
  let freeDelivery = false;
  for (const { p, e } of chosen) {
    e.perLine.forEach((d, i) => {
      lines[i].lineDiscountCents += d;
    });
    orderDiscount += e.order;
    if (e.freeDelivery) freeDelivery = true;
    const amt = e.order + e.perLine.reduce((a, b) => a + b, 0) + (e.freeDelivery ? baseDeliveryFee : 0);
    if (amt > 0) appliedPromotions.push({ id: p.id, name: p.name, code: p.code, amountCents: amt });
  }
  if (code && appliedPromotions.some((a) => a.code === code)) couponMessage = null;

  for (const l of lines) {
    l.lineDiscountCents = Math.min(l.lineDiscountCents, l.lineSubtotalCents);
    l.lineTotalCents = l.lineSubtotalCents - l.lineDiscountCents;
  }
  const subtotal = lines.reduce((a, l) => a + l.lineTotalCents, 0);
  const manual = Math.max(0, Math.floor(ctx.manualDiscountCents ?? 0));
  orderDiscount = Math.min(subtotal, floorToShilling(orderDiscount + manual));
  const shares = allocateProportionally(
    orderDiscount,
    lines.map((l) => l.lineTotalCents),
  );
  lines.forEach((l, i) => (l.orderDiscountShareCents = shares[i]));
  const deliveryFee = freeDelivery ? 0 : baseDeliveryFee;

  // ── Tax ──
  const s = ctx.settings;
  const rate = s.vatRegistered ? s.vatRateBp : 0;
  const inclusive = s.pricesIncludeTax;
  const taxOn = (amount: number) =>
    rate === 0 ? 0 : inclusive ? Math.round((amount * rate) / (10000 + rate)) : Math.round((amount * rate) / 10000);
  let tax = 0;
  for (const l of lines) {
    const net = l.lineTotalCents - l.orderDiscountShareCents;
    l.taxCents = l.taxCategory === "STANDARD" ? taxOn(net) : 0;
    tax += l.taxCents;
  }
  tax += taxOn(deliveryFee);
  if (!inclusive) tax = roundToShilling(tax);

  const totalBeforeTax = subtotal - orderDiscount + deliveryFee;
  const total = inclusive ? totalBeforeTax : totalBeforeTax + tax;
  const lineDiscounts = lines.reduce((a, l) => a + l.lineDiscountCents, 0);

  return {
    lines,
    issues,
    subtotalCents: subtotal,
    discountCents: lineDiscounts + orderDiscount,
    orderDiscountCents: orderDiscount,
    deliveryFeeCents: deliveryFee,
    taxCents: tax,
    totalCents: total,
    appliedPromotions,
    couponMessage,
    deliveryZone,
    taxInclusive: inclusive,
  };
}
