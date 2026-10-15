import { sql } from "drizzle-orm";
import { db } from "@/db";

/**
 * Report definitions (shown to users next to each figure):
 *
 * - Counted orders: orders that were paid or are being fulfilled — status PAID, PROCESSING, READY_FOR_COLLECTION,
 *   DISPATCHED, DELIVERED, COMPLETED, PARTIALLY_REFUNDED or REFUNDED. Unpaid, awaiting-payment and cancelled
 *   orders are excluded. Orders are dated by when they were placed (Nairobi time).
 * - Gross sales: total charged on counted orders = items after all discounts + delivery fees (+ VAT when prices
 *   exclude VAT). Refunds are NOT deducted.
 * - Refunds: refunds recorded in the period (dated by refund date), whichever period the sale was in.
 * - Net sales: gross sales − refunds.
 * - Merchandise revenue (ex VAT, ex delivery): line totals after discounts, minus VAT on those lines, for counted orders.
 * - Cost of goods sold: units sold (less units refunded) × the weighted-average cost recorded at the time of sale.
 *   Lines with no recorded cost are excluded and reported as a coverage figure, so gross profit is an ESTIMATE
 *   whenever coverage is below 100%.
 * - Gross profit: merchandise revenue (on costed lines) − cost of goods sold. This is not net profit: operating
 *   expenses, delivery costs, payment charges and other costs are not deducted.
 */

export const COUNTED = sql.raw(`('PAID','PROCESSING','READY_FOR_COLLECTION','DISPATCHED','DELIVERED','COMPLETED','PARTIALLY_REFUNDED','REFUNDED')`);

export type Range = { from: Date; to: Date };

export function nairobiDayStart(d = new Date()) {
  const eat = new Date(d.getTime() + 3 * 3600_000);
  return new Date(`${eat.toISOString().slice(0, 10)}T00:00:00+03:00`);
}

export function presetRange(preset: string | undefined, from?: string, to?: string): Range & { label: string; key: string } {
  const today = nairobiDayStart();
  const day = 86400_000;
  if (from && to && /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
    const f = new Date(`${from}T00:00:00+03:00`);
    const t = new Date(new Date(`${to}T00:00:00+03:00`).getTime() + day);
    return { from: f, to: t, label: `${from} to ${to}`, key: "custom" };
  }
  switch (preset) {
    case "yesterday":
      return { from: new Date(today.getTime() - day), to: today, label: "Yesterday", key: "yesterday" };
    case "7d":
      return { from: new Date(today.getTime() - 6 * day), to: new Date(today.getTime() + day), label: "Last 7 days", key: "7d" };
    case "30d":
      return { from: new Date(today.getTime() - 29 * day), to: new Date(today.getTime() + day), label: "Last 30 days", key: "30d" };
    case "month": {
      const eat = new Date(today.getTime() + 3 * 3600_000);
      const f = new Date(`${eat.toISOString().slice(0, 7)}-01T00:00:00+03:00`);
      return { from: f, to: new Date(today.getTime() + day), label: "This month", key: "month" };
    }
    case "year": {
      const eat = new Date(today.getTime() + 3 * 3600_000);
      return { from: new Date(`${eat.toISOString().slice(0, 4)}-01-01T00:00:00+03:00`), to: new Date(today.getTime() + day), label: "This year", key: "year" };
    }
    default:
      return { from: today, to: new Date(today.getTime() + day), label: "Today", key: "today" };
  }
}

export function previousRange(r: Range): Range {
  const len = r.to.getTime() - r.from.getTime();
  return { from: new Date(r.from.getTime() - len), to: r.from };
}

const n = (x: unknown) => Number(x ?? 0);

export async function salesSummary(r: Range) {
  const s = await db.execute(sql`
    select count(*)::int as orders,
      coalesce(sum(total_cents),0)::bigint as gross,
      coalesce(sum(delivery_fee_cents),0)::bigint as delivery,
      coalesce(sum(tax_cents),0)::bigint as tax,
      coalesce(sum(discount_cents),0)::bigint as order_discounts,
      coalesce(sum((select sum(discount_cents) from order_items oi where oi.order_id = o.id)),0)::bigint as line_discounts,
      count(*) filter (where is_demo)::int as demo
    from orders o where status in ${COUNTED} and placed_at >= ${r.from} and placed_at < ${r.to}`);
  const ref = await db.execute(sql`select count(*)::int as n, coalesce(sum(amount_cents),0)::bigint as total from refunds where created_at >= ${r.from} and created_at < ${r.to}`);
  const cost = await db.execute(sql`
    select
      coalesce(sum(case when oi.unit_cost_cents is not null then (oi.line_total_cents - oi.tax_cents) * (oi.qty - oi.qty_refunded) / oi.qty end),0)::bigint as costed_revenue,
      coalesce(sum(case when oi.unit_cost_cents is not null then oi.unit_cost_cents * (oi.qty - oi.qty_refunded) end),0)::bigint as cogs,
      coalesce(sum((oi.line_total_cents - oi.tax_cents) * (oi.qty - oi.qty_refunded) / oi.qty),0)::bigint as merch_revenue,
      count(*) filter (where oi.unit_cost_cents is null)::int as uncosted_lines,
      count(*)::int as lines
    from order_items oi join orders o on o.id = oi.order_id
    where o.status in ${COUNTED} and o.placed_at >= ${r.from} and o.placed_at < ${r.to}`);
  const a = s.rows[0];
  const c = cost.rows[0];
  const gross = n(a.gross);
  const refunds = n(ref.rows[0].total);
  const orders = n(a.orders);
  const lines = n(c.lines);
  return {
    orders,
    gross,
    refunds,
    refundCount: n(ref.rows[0].n),
    net: gross - refunds,
    aov: orders ? Math.round(gross / orders) : 0,
    delivery: n(a.delivery),
    tax: n(a.tax),
    discounts: n(a.order_discounts) + n(a.line_discounts),
    merchRevenue: n(c.merch_revenue),
    cogs: n(c.cogs),
    grossProfit: n(c.costed_revenue) - n(c.cogs),
    costCoverage: lines ? (lines - n(c.uncosted_lines)) / lines : 1,
    demoOrders: n(a.demo),
  };
}

export async function dailySeries(r: Range) {
  const res = await db.execute(sql`
    with days as (select generate_series(${r.from}::timestamptz, ${r.to}::timestamptz - interval '1 day', interval '1 day') as d)
    select to_char(d at time zone 'Africa/Nairobi', 'YYYY-MM-DD') as day,
      coalesce((select sum(total_cents) from orders o where o.status in ${COUNTED} and o.placed_at >= d and o.placed_at < d + interval '1 day'),0)::bigint as gross,
      coalesce((select count(*) from orders o where o.status in ${COUNTED} and o.placed_at >= d and o.placed_at < d + interval '1 day'),0)::int as orders
    from days order by d`);
  return res.rows.map((x) => ({ day: String(x.day), gross: n(x.gross), orders: n(x.orders) }));
}

export async function operationalCounts() {
  const r = await db.execute(sql`select
    count(*) filter (where status = 'AWAITING_PAYMENT')::int as awaiting_payment,
    coalesce(sum(total_cents - amount_paid_cents) filter (where status = 'AWAITING_PAYMENT'),0)::bigint as awaiting_amount,
    count(*) filter (where status in ('PAID','PENDING') )::int as pending,
    count(*) filter (where status in ('PAID','PROCESSING') and fulfilment_method in ('LOCAL_DELIVERY','COURIER'))::int as to_dispatch,
    count(*) filter (where status in ('PAID','PROCESSING') and fulfilment_method = 'COLLECTION')::int as to_prepare_collection,
    count(*) filter (where amount_paid_cents < total_cents and status in ('PROCESSING','DISPATCHED','DELIVERED','READY_FOR_COLLECTION'))::int as unpaid_in_progress
    from orders`);
  const p = await db.execute(sql`select count(*) filter (where status = 'FAILED' and created_at > now() - interval '24 hours')::int as failed24,
    count(*) filter (where status = 'PENDING' and created_at < now() - interval '10 minutes')::int as stuck from payment_attempts`);
  const s = await db.execute(sql`
    with v as (select v.id, v.reorder_level, coalesce(sum(b.on_hand - b.reserved),0) as avail
      from product_variants v join products p on p.id = v.product_id left join inventory_balances b on b.variant_id = v.id
      where v.is_active and not v.is_bundle and p.status = 'PUBLISHED' group by v.id)
    select count(*) filter (where avail <= 0)::int as out_of_stock, count(*) filter (where avail > 0 and reorder_level > 0 and avail <= reorder_level)::int as low from v`);
  const refundsPending = await db.execute(sql`select count(*)::int as n from refunds where status = 'PENDING_PAYOUT'`);
  const feedback = await db.execute(sql`select (select count(*) from reviews where status in ('PENDING','FLAGGED'))::int as reviews, (select count(*) from product_questions where status = 'PENDING')::int as questions, (select count(*) from support_tickets where status in ('OPEN','IN_PROGRESS'))::int as tickets, (select count(*) from products where needs_review and status <> 'ARCHIVED')::int as products_review`);
  return { ...r.rows[0], ...p.rows[0], ...s.rows[0], refundsPending: n(refundsPending.rows[0].n), ...feedback.rows[0] } as Record<string, number>;
}

export async function bestsellersInRange(r: Range, limit = 10) {
  const res = await db.execute(sql`
    select oi.product_name as name, oi.variant_name as variant, sum(oi.qty - oi.qty_refunded)::int as units, sum(oi.line_total_cents)::bigint as revenue
    from order_items oi join orders o on o.id = oi.order_id
    where o.status in ${COUNTED} and o.placed_at >= ${r.from} and o.placed_at < ${r.to}
    group by oi.product_name, oi.variant_name order by units desc, revenue desc limit ${limit}`);
  return res.rows.map((x) => ({ name: String(x.name), variant: String(x.variant), units: n(x.units), revenue: n(x.revenue) }));
}

export async function customerGrowth(r: Range) {
  const prev = previousRange(r);
  const res = await db.execute(sql`select
    count(*) filter (where created_at >= ${r.from} and created_at < ${r.to})::int as new_now,
    count(*) filter (where created_at >= ${prev.from} and created_at < ${prev.to})::int as new_prev,
    count(*)::int as total from customers where anonymized_at is null`);
  return { newNow: n(res.rows[0].new_now), newPrev: n(res.rows[0].new_prev), total: n(res.rows[0].total) };
}

export async function salesByDimension(r: Range, dim: "product" | "category" | "cashier" | "method" | "source" | "promotion") {
  const q = {
    product: sql`select oi.product_name || ' · ' || oi.variant_name as label, sum(oi.qty - oi.qty_refunded)::int as units, sum(oi.line_total_cents)::bigint as amount, count(distinct o.id)::int as orders
      from order_items oi join orders o on o.id = oi.order_id where o.status in ${COUNTED} and o.placed_at >= ${r.from} and o.placed_at < ${r.to} group by 1 order by amount desc`,
    category: sql`select coalesce(c.name, 'Uncategorised') as label, sum(oi.qty - oi.qty_refunded)::int as units, sum(oi.line_total_cents)::bigint as amount, count(distinct o.id)::int as orders
      from order_items oi join orders o on o.id = oi.order_id join product_variants v on v.id = oi.variant_id join products p on p.id = v.product_id left join categories c on c.id = p.category_id
      where o.status in ${COUNTED} and o.placed_at >= ${r.from} and o.placed_at < ${r.to} group by 1 order by amount desc`,
    cashier: sql`select coalesce(u.name, 'Online') as label, null::int as units, sum(o.total_cents)::bigint as amount, count(*)::int as orders
      from orders o left join users u on u.id = o.cashier_id where o.status in ${COUNTED} and o.placed_at >= ${r.from} and o.placed_at < ${r.to} group by 1 order by amount desc`,
    method: sql`select p.method::text as label, null::int as units, sum(p.amount_cents)::bigint as amount, count(*)::int as orders
      from payments p where p.status = 'SUCCEEDED' and p.received_at >= ${r.from} and p.received_at < ${r.to} group by 1 order by amount desc`,
    source: sql`select case o.source when 'POS' then 'Point of sale' when 'ONLINE' then 'Online' else 'Manual' end as label, null::int as units, sum(o.total_cents)::bigint as amount, count(*)::int as orders
      from orders o where o.status in ${COUNTED} and o.placed_at >= ${r.from} and o.placed_at < ${r.to} group by 1 order by amount desc`,
    promotion: sql`select pr.name as label, null::int as units, sum(r.amount_cents)::bigint as amount, count(*)::int as orders
      from promotion_redemptions r join promotions pr on pr.id = r.promotion_id join orders o on o.id = r.order_id
      where o.status in ${COUNTED} and o.placed_at >= ${r.from} and o.placed_at < ${r.to} group by 1 order by amount desc`,
  }[dim];
  const res = await db.execute(q);
  return res.rows.map((x) => ({ label: String(x.label), units: x.units == null ? null : n(x.units), amount: n(x.amount), orders: n(x.orders) }));
}
