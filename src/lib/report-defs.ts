import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import type { Permission } from "./permissions";
import { COUNTED, salesByDimension, salesSummary, type Range } from "./reports";
import { supplierBalances } from "./purchasing";

/**
 * Every report in /admin/reports is defined here once and used by both the page and the CSV export,
 * so the numbers on screen and in the spreadsheet always match.
 */

export type ColKind = "text" | "int" | "money" | "pct" | "date";
export type Col = { key: string; label: string; kind: ColKind };
export type ReportResult = { columns: Col[]; rows: Record<string, unknown>[]; totals?: Record<string, unknown>; notes?: string[] };
export type ReportDef = {
  key: string;
  title: string;
  group: "Sales" | "Money" | "Stock" | "Customers & service";
  perm: Permission;
  description: string;
  /** Whether the date range affects this report (stock snapshots don't). */
  usesRange: boolean;
  options?: { name: string; label: string; values: [string, string][] };
  run: (r: Range, opts: Record<string, string | undefined>) => Promise<ReportResult>;
};

const n = (x: unknown) => Number(x ?? 0);
const t = (label: string, key = label.toLowerCase().replace(/\W+/g, "_")): Col => ({ key, label, kind: "text" });
const i = (label: string, key: string): Col => ({ key, label, kind: "int" });
const m = (label: string, key: string): Col => ({ key, label, kind: "money" });
const p = (label: string, key: string): Col => ({ key, label, kind: "pct" });

async function rows(q: SQL) {
  return (await db.execute(q)).rows as Record<string, unknown>[];
}

function sum(rs: Record<string, unknown>[], keys: string[]) {
  return Object.fromEntries(keys.map((k) => [k, rs.reduce((a, r) => a + n(r[k]), 0)]));
}

const METHOD_LABEL: Record<string, string> = { MPESA: "M-Pesa", CASH: "Cash", CARD: "Card", BANK_TRANSFER: "Bank transfer", CASH_ON_DELIVERY: "Cash on delivery", OTHER: "Other" };

function dimension(dim: Parameters<typeof salesByDimension>[1], label: string, withUnits: boolean, amountLabel = "Sales"): ReportDef["run"] {
  return async (r) => {
    const data = await salesByDimension(r, dim);
    const rs = data.map((d) => ({ label: dim === "method" ? METHOD_LABEL[d.label] ?? d.label : d.label, units: d.units, orders: d.orders, amount: d.amount }));
    const cols: Col[] = [t(label, "label"), ...(withUnits ? [i("Units (net of returns)", "units")] : []), i(dim === "method" ? "Payments" : dim === "promotion" ? "Uses" : "Orders", "orders"), m(amountLabel, "amount")];
    return { columns: cols, rows: rs, totals: { label: "Total", ...sum(rs, withUnits ? ["units", "amount"] : ["amount", "orders"]) } };
  };
}

export const REPORTS: ReportDef[] = [
  {
    key: "sales-period",
    title: "Sales over time",
    group: "Sales",
    perm: "reports.sales",
    description: "Counted orders grouped by day, week, month or year (Nairobi time). Gross sales include delivery and VAT, after discounts.",
    usesRange: true,
    options: { name: "grain", label: "Group by", values: [["day", "Day"], ["week", "Week"], ["month", "Month"], ["year", "Year"]] },
    run: async (r, o) => {
      const grain = ["day", "week", "month", "year"].includes(o.grain ?? "") ? o.grain! : "day";
      const fmt = { day: "YYYY-MM-DD", week: "IYYY-\"W\"IW", month: "YYYY-MM", year: "YYYY" }[grain];
      const rs = await rows(sql`
        with o as (select date_trunc(${grain}, placed_at at time zone 'Africa/Nairobi') as bucket, * from orders where status in ${COUNTED} and placed_at >= ${r.from} and placed_at < ${r.to}),
        rf as (select date_trunc(${grain}, created_at at time zone 'Africa/Nairobi') as bucket, sum(amount_cents) as refunds from refunds where created_at >= ${r.from} and created_at < ${r.to} group by 1),
        g as (select bucket, count(*)::int as orders, sum(total_cents)::bigint as gross, sum(discount_cents + coalesce((select sum(discount_cents) from order_items oi where oi.order_id = o.id),0))::bigint as discounts,
          sum(delivery_fee_cents)::bigint as delivery, sum(tax_cents)::bigint as tax from o group by bucket)
        select to_char(coalesce(g.bucket, rf.bucket), ${fmt}) as period, coalesce(g.orders,0) as orders, coalesce(g.gross,0) as gross, coalesce(g.discounts,0) as discounts,
          coalesce(g.delivery,0) as delivery, coalesce(g.tax,0) as tax, coalesce(rf.refunds,0)::bigint as refunds, (coalesce(g.gross,0) - coalesce(rf.refunds,0))::bigint as net,
          case when coalesce(g.orders,0) > 0 then round(g.gross::numeric / g.orders)::bigint else 0 end as aov
        from g full join rf on rf.bucket = g.bucket order by coalesce(g.bucket, rf.bucket)`);
      const tot = sum(rs, ["orders", "gross", "discounts", "delivery", "tax", "refunds", "net"]);
      return {
        columns: [t("Period", "period"), i("Orders", "orders"), m("Gross sales", "gross"), m("Discounts", "discounts"), m("Delivery fees", "delivery"), m("VAT", "tax"), m("Refunds", "refunds"), m("Net sales", "net"), m("Average order", "aov")],
        rows: rs,
        totals: { period: "Total", ...tot, aov: tot.orders ? Math.round(tot.gross / tot.orders) : 0 },
        notes: ["Refunds are dated by when they were issued, so a refund can fall in a later period than its sale."],
      };
    },
  },
  { key: "sales-product", title: "Sales by product", group: "Sales", perm: "reports.sales", description: "Line totals after discounts (including VAT when charged), for counted orders.", usesRange: true, run: dimension("product", "Product", true) },
  { key: "sales-category", title: "Sales by category", group: "Sales", perm: "reports.sales", description: "Line totals after discounts, grouped by the product's current category.", usesRange: true, run: dimension("category", "Category", true) },
  { key: "sales-cashier", title: "Sales by cashier", group: "Sales", perm: "reports.sales", description: "Order totals by the staff member who rang up the sale. Online orders are grouped as 'Online'.", usesRange: true, run: dimension("cashier", "Cashier", false) },
  { key: "sales-method", title: "Payments by method", group: "Sales", perm: "reports.sales", description: "Successful payments received in the period, by method (dated by when the money was received).", usesRange: true, run: dimension("method", "Method", false, "Received") },
  { key: "sales-source", title: "Online vs shop", group: "Sales", perm: "reports.sales", description: "Counted orders by where they were placed.", usesRange: true, run: dimension("source", "Channel", false) },
  { key: "sales-promotion", title: "Discounts and promotions", group: "Sales", perm: "reports.sales", description: "Discount given by each promotion or coupon on counted orders. Manual POS discounts are listed separately.", usesRange: true,
    run: async (r) => {
      const promo = await salesByDimension(r, "promotion");
      const manual = await rows(sql`select count(distinct o.id)::int as orders, coalesce(sum(oi.discount_cents),0)::bigint as amount from order_items oi join orders o on o.id = oi.order_id
        where o.status in ${COUNTED} and o.placed_at >= ${r.from} and o.placed_at < ${r.to} and o.source = 'POS' and oi.discount_cents > 0
        and not exists (select 1 from promotion_redemptions pr where pr.order_id = o.id)`);
      const rs: Record<string, unknown>[] = promo.map((d) => ({ label: d.label, orders: d.orders, amount: d.amount }));
      if (n(manual[0]?.amount) > 0) rs.push({ label: "Manual discount at till", orders: n(manual[0].orders), amount: n(manual[0].amount) });
      return { columns: [t("Promotion", "label"), i("Orders", "orders"), m("Discount given", "amount")], rows: rs, totals: { label: "Total", ...sum(rs, ["orders", "amount"]) } };
    },
  },
  {
    key: "refunds",
    title: "Refunds and cancellations",
    group: "Sales",
    perm: "reports.sales",
    description: "Every refund issued in the period, plus orders cancelled in the period.",
    usesRange: true,
    run: async (r) => {
      const rf = await rows(sql`select 'Refund' as kind, rf.number as ref, o.number as order_number, to_char(rf.created_at at time zone 'Africa/Nairobi', 'YYYY-MM-DD HH24:MI') as date,
          rf.reason, rf.method::text as method, rf.status::text as status, rf.amount_cents::bigint as amount
        from refunds rf join orders o on o.id = rf.order_id where rf.created_at >= ${r.from} and rf.created_at < ${r.to}
        union all
        select 'Cancelled order', o.number, o.number, to_char(o.cancelled_at at time zone 'Africa/Nairobi', 'YYYY-MM-DD HH24:MI'), null, null, o.payment_status::text, o.total_cents::bigint
        from orders o where o.status = 'CANCELLED' and o.cancelled_at >= ${r.from} and o.cancelled_at < ${r.to}
        order by 4`);
      const refundTotal = rf.filter((x) => x.kind === "Refund").reduce((a, x) => a + n(x.amount), 0);
      return {
        columns: [t("Type", "kind"), t("Reference", "ref"), t("Order", "order_number"), t("Date", "date"), t("Reason", "reason"), t("Refunded by", "method"), t("Status", "status"), m("Amount", "amount")],
        rows: rf.map((x) => ({ ...x, method: x.method ? METHOD_LABEL[String(x.method)] ?? x.method : "" })),
        totals: { kind: "Refunds total", amount: refundTotal },
        notes: ["Cancelled orders were never counted as sales, so their amounts are not deducted anywhere. Refund status 'PENDING_PAYOUT' means the money still has to be sent."],
      };
    },
  },
  {
    key: "gross-profit",
    title: "Gross profit by product",
    group: "Money",
    perm: "reports.financial",
    description: "Merchandise revenue (excluding VAT and delivery) minus the average cost recorded at the time of sale. Not net profit.",
    usesRange: true,
    run: async (r) => {
      const rs = await rows(sql`select oi.product_name || ' · ' || oi.variant_name as label, sum(oi.qty - oi.qty_refunded)::int as units,
          sum((oi.line_total_cents - oi.tax_cents) * (oi.qty - oi.qty_refunded) / oi.qty)::bigint as revenue,
          sum(oi.unit_cost_cents * (oi.qty - oi.qty_refunded))::bigint as cogs,
          bool_or(oi.unit_cost_cents is null) as missing_cost
        from order_items oi join orders o on o.id = oi.order_id where o.status in ${COUNTED} and o.placed_at >= ${r.from} and o.placed_at < ${r.to}
        group by 1 order by revenue desc`);
      const out = rs.map((x) => {
        const missing = Boolean(x.missing_cost);
        const gp = missing ? null : n(x.revenue) - n(x.cogs);
        return { label: x.label, units: n(x.units), revenue: n(x.revenue), cogs: missing ? null : n(x.cogs), gp, margin: gp != null && n(x.revenue) ? gp / n(x.revenue) : null, cost_note: missing ? "Cost not recorded" : "" };
      });
      const costed = out.filter((x) => x.gp != null);
      const rev = costed.reduce((a, x) => a + x.revenue, 0);
      const gp = costed.reduce((a, x) => a + (x.gp ?? 0), 0);
      return {
        columns: [t("Product", "label"), i("Units", "units"), m("Revenue ex VAT", "revenue"), m("Cost of goods", "cogs"), m("Gross profit", "gp"), p("Margin", "margin"), t("Note", "cost_note")],
        rows: out,
        totals: { label: "Total (costed lines)", units: costed.reduce((a, x) => a + x.units, 0), revenue: rev, cogs: costed.reduce((a, x) => a + (x.cogs ?? 0), 0), gp, margin: rev ? gp / rev : null },
        notes: [
          "Products sold before a cost was recorded show no profit figure and are left out of the total. Record purchase costs when receiving goods to fill these in.",
          "Gross profit is not net profit: rent, wages, delivery costs, M-Pesa charges and other expenses are not deducted. See 'Expenses vs gross profit'.",
        ],
      };
    },
  },
  {
    key: "expenses-vs-gp",
    title: "Expenses vs gross profit",
    group: "Money",
    perm: "reports.financial",
    description: "Approved expenses by category compared with estimated gross profit for the same period.",
    usesRange: true,
    run: async (r) => {
      const [summary, ex, pending] = await Promise.all([
        salesSummary(r),
        rows(sql`select c.name as label, count(*)::int as count, sum(e.amount_cents)::bigint as amount from expenses e join expense_categories c on c.id = e.category_id
          where e.status = 'APPROVED' and e.date >= ${r.from} and e.date < ${r.to} group by 1 order by amount desc`),
        rows(sql`select count(*)::int as count, coalesce(sum(amount_cents),0)::bigint as amount from expenses where status = 'SUBMITTED' and date >= ${r.from} and date < ${r.to}`),
      ]);
      const totalEx = ex.reduce((a, x) => a + n(x.amount), 0);
      const out: Record<string, unknown>[] = [
        { label: "Gross profit (estimate)", count: null, amount: summary.grossProfit },
        ...ex.map((x) => ({ label: `Expense: ${x.label}`, count: n(x.count), amount: -n(x.amount) })),
      ];
      const notes = [
        `Cost of goods is known for ${Math.round(summary.costCoverage * 100)}% of items sold in this period.`,
        "This is an operating estimate from recorded data, not an accounting profit-and-loss statement. Have your accountant prepare statutory accounts and tax returns.",
      ];
      if (n(pending[0]?.count)) notes.unshift(`${n(pending[0].count)} expense(s) totalling KES ${(n(pending[0].amount) / 100).toLocaleString("en-KE")} are waiting for approval and are not included.`);
      return { columns: [t("Line", "label"), i("Entries", "count"), m("Amount", "amount")], rows: out, totals: { label: "Gross profit minus expenses (estimate)", amount: summary.grossProfit - totalEx }, notes };
    },
  },
  {
    key: "supplier-balances",
    title: "Supplier balances",
    group: "Money",
    perm: "reports.financial",
    description: "Supplier invoices recorded (not void) minus payments recorded, all time.",
    usesRange: false,
    run: async () => {
      const rs = (await supplierBalances()).map((s) => ({ label: s.name, invoiced: s.invoiced, paid: s.paid, balance: s.balance }));
      return { columns: [t("Supplier", "label"), m("Invoiced", "invoiced"), m("Paid", "paid"), m("Balance owed", "balance")], rows: rs, totals: { label: "Total", ...sum(rs, ["invoiced", "paid", "balance"]) } };
    },
  },
  {
    key: "purchasing",
    title: "Purchases received",
    group: "Money",
    perm: "reports.financial",
    description: "Goods received into stock in the period, by supplier, at the unit cost entered when receiving.",
    usesRange: true,
    run: async (r) => {
      const rs = await rows(sql`select coalesce(s.name, 'No supplier') as label, count(distinct sm.ref_id)::int as receipts, sum(sm.on_hand_delta)::int as units, sum(sm.on_hand_delta * coalesce(sm.unit_cost_cents,0))::bigint as value,
          bool_or(sm.unit_cost_cents is null) as missing
        from stock_movements sm left join goods_receipts g on g.id::text = sm.ref_id::text and sm.ref_type = 'GOODS_RECEIPT' left join suppliers s on s.id = g.supplier_id
        where sm.type = 'PURCHASE_RECEIVED' and sm.created_at >= ${r.from} and sm.created_at < ${r.to} group by 1 order by value desc`);
      const out = rs.map((x) => ({ label: x.label, receipts: n(x.receipts), units: n(x.units), value: n(x.value), note: x.missing ? "Some lines had no cost" : "" }));
      return { columns: [t("Supplier", "label"), i("Deliveries", "receipts"), i("Units", "units"), m("Value at cost", "value"), t("Note", "note")], rows: out, totals: { label: "Total", ...sum(out, ["receipts", "units", "value"]) } };
    },
  },
  {
    key: "inventory-valuation",
    title: "Stock valuation",
    group: "Stock",
    perm: "reports.financial",
    description: "Units on hand right now × weighted-average cost, by product. A snapshot: the date range does not apply.",
    usesRange: false,
    run: async () => {
      const rs = await rows(sql`select p.name || ' · ' || v.name as label, v.sku, coalesce(sum(b.on_hand),0)::int as on_hand, coalesce(sum(b.quarantined),0)::int as quarantined,
          v.avg_cost_cents as cost, v.price_cents as price
        from product_variants v join products p on p.id = v.product_id left join inventory_balances b on b.variant_id = v.id
        where not v.is_bundle and p.status <> 'ARCHIVED' group by v.id, p.name order by p.name, v.name`);
      const out = rs.map((x) => ({
        label: x.label, sku: x.sku, on_hand: n(x.on_hand), quarantined: n(x.quarantined),
        cost: x.cost == null ? null : n(x.cost), value: x.cost == null ? null : n(x.cost) * n(x.on_hand),
        retail: x.price == null ? null : n(x.price) * n(x.on_hand), note: x.cost == null && n(x.on_hand) ? "No cost recorded" : "",
      }));
      return {
        columns: [t("Product", "label"), t("SKU", "sku"), i("On hand", "on_hand"), i("Quarantined", "quarantined"), m("Average cost", "cost"), m("Value at cost", "value"), m("Value at selling price", "retail"), t("Note", "note")],
        rows: out,
        totals: { label: "Total", on_hand: out.reduce((a, x) => a + x.on_hand, 0), value: out.reduce((a, x) => a + (x.value ?? 0), 0), retail: out.reduce((a, x) => a + (x.retail ?? 0), 0) },
        notes: ["Quarantined units (damaged returns awaiting a decision) are not included in 'On hand' or the values."],
      };
    },
  },
  {
    key: "stock-movement",
    title: "Stock movement summary",
    group: "Stock",
    perm: "reports.inventory",
    description: "Net change in units on hand, by product and reason, from the stock ledger.",
    usesRange: true,
    run: async (r) => {
      const rs = await rows(sql`select p.name || ' · ' || v.name as label,
          coalesce(sum(sm.on_hand_delta) filter (where sm.type in ('INITIAL','PURCHASE_RECEIVED')),0)::int as received,
          coalesce(-sum(sm.on_hand_delta) filter (where sm.type = 'SALE'),0)::int as sold,
          coalesce(sum(sm.on_hand_delta) filter (where sm.type = 'CUSTOMER_RETURN'),0)::int as returned,
          coalesce(sum(sm.on_hand_delta) filter (where sm.type in ('DAMAGE','EXPIRY','QUARANTINE_WRITE_OFF','SUPPLIER_RETURN')),0)::int as written_off,
          coalesce(sum(sm.on_hand_delta) filter (where sm.type = 'ADJUSTMENT'),0)::int as adjusted,
          coalesce(sum(sm.on_hand_delta) filter (where sm.type in ('TRANSFER_IN','TRANSFER_OUT')),0)::int as transfers,
          coalesce(sum(sm.on_hand_delta),0)::int as net
        from stock_movements sm join product_variants v on v.id = sm.variant_id join products p on p.id = v.product_id
        where sm.created_at >= ${r.from} and sm.created_at < ${r.to} and sm.on_hand_delta <> 0
        group by 1 order by 1`);
      return {
        columns: [t("Product", "label"), i("Received", "received"), i("Sold", "sold"), i("Customer returns", "returned"), i("Written off / returned to supplier", "written_off"), i("Adjustments", "adjusted"), i("Transfers (net)", "transfers"), i("Net change", "net")],
        rows: rs,
        totals: { label: "Total", ...sum(rs, ["received", "sold", "returned", "written_off", "adjusted", "transfers", "net"]) },
        notes: ["Reservations for unpaid online orders don't change units on hand and aren't shown here."],
      };
    },
  },
  {
    key: "low-stock",
    title: "Low and out of stock",
    group: "Stock",
    perm: "reports.inventory",
    description: "Active products at or below their reorder level right now. A snapshot: the date range does not apply.",
    usesRange: false,
    run: async () => {
      const rs = await rows(sql`select p.name || ' · ' || v.name as label, v.sku, coalesce(sum(b.on_hand),0)::int as on_hand, coalesce(sum(b.reserved),0)::int as reserved,
          coalesce(sum(b.on_hand - b.reserved),0)::int as available, v.reorder_level, v.reorder_qty, p.status::text as status
        from product_variants v join products p on p.id = v.product_id left join inventory_balances b on b.variant_id = v.id
        where v.is_active and not v.is_bundle and p.status <> 'ARCHIVED' group by v.id, p.name, p.status
        having coalesce(sum(b.on_hand - b.reserved),0) <= greatest(v.reorder_level, 0) order by available, label`);
      return { columns: [t("Product", "label"), t("SKU", "sku"), i("On hand", "on_hand"), i("Reserved", "reserved"), i("Available", "available"), i("Reorder level", "reorder_level"), i("Suggested order", "reorder_qty"), t("Listing", "status")], rows: rs };
    },
  },
  {
    key: "expiring",
    title: "Expiring batches",
    group: "Stock",
    perm: "reports.inventory",
    description: "Batches with stock that expire within the next 90 days, or have already expired.",
    usesRange: false,
    run: async () => {
      const rs = await rows(sql`select p.name || ' · ' || v.name as label, b.batch_no, to_char(b.expires_at, 'YYYY-MM-DD') as expires, b.qty_on_hand::int as qty, l.name as location,
          (b.expires_at::date - (now() at time zone 'Africa/Nairobi')::date)::int as days_left
        from stock_batches b join product_variants v on v.id = b.variant_id join products p on p.id = v.product_id join locations l on l.id = b.location_id
        where b.qty_on_hand > 0 and b.expires_at is not null and b.expires_at < now() + interval '90 days' order by b.expires_at`);
      return { columns: [t("Product", "label"), t("Batch", "batch_no"), t("Expires", "expires"), i("Days left", "days_left"), i("Units", "qty"), t("Location", "location")], rows: rs };
    },
  },
  {
    key: "customers",
    title: "Customer retention",
    group: "Customers & service",
    perm: "reports.sales",
    description: "Customers who bought in the period, split into first-time and returning buyers.",
    usesRange: true,
    run: async (r) => {
      const rs = await rows(sql`with buyers as (
          select o.customer_id, count(*)::int as orders, sum(o.total_cents)::bigint as spent,
            exists (select 1 from orders o2 where o2.customer_id = o.customer_id and o2.status in ${COUNTED} and o2.placed_at < ${r.from}) as is_returning
          from orders o where o.status in ${COUNTED} and o.placed_at >= ${r.from} and o.placed_at < ${r.to} and o.customer_id is not null group by o.customer_id)
        select case when is_returning then 'Returning customers' else 'First-time customers' end as label, count(*)::int as customers, sum(orders)::int as orders, sum(spent)::bigint as amount,
          count(*) filter (where orders > 1)::int as repeat_in_period
        from buyers group by 1 order by 1 desc`);
      const walkIn = await rows(sql`select count(*)::int as orders, coalesce(sum(total_cents),0)::bigint as amount from orders where status in ${COUNTED} and placed_at >= ${r.from} and placed_at < ${r.to} and customer_id is null`);
      const out = [...rs];
      if (n(walkIn[0]?.orders)) out.push({ label: "Walk-in (no customer recorded)", customers: null, orders: n(walkIn[0].orders), amount: n(walkIn[0].amount), repeat_in_period: null });
      const buyers = rs.reduce((a, x) => a + n(x.customers), 0);
      const ret = n(rs.find((x) => x.label === "Returning customers")?.customers);
      return {
        columns: [t("Group", "label"), i("Customers", "customers"), i("Orders", "orders"), m("Spent", "amount"), i("Bought more than once in period", "repeat_in_period")],
        rows: out,
        totals: { label: "Total", ...sum(out, ["customers", "orders", "amount"]) },
        notes: [buyers ? `${Math.round((ret / buyers) * 100)}% of identified buyers in this period had bought before.` : "No identified buyers in this period."],
      };
    },
  },
  {
    key: "delivery",
    title: "Delivery performance",
    group: "Customers & service",
    perm: "reports.sales",
    description: "Deliveries for orders placed in the period, by zone and outcome. Time is from dispatch to delivery.",
    usesRange: true,
    run: async (r) => {
      const rs = await rows(sql`select coalesce(z.name, 'No zone') as label, count(*)::int as total,
          count(*) filter (where d.status = 'DELIVERED')::int as delivered, count(*) filter (where d.status in ('FAILED','RETURNED'))::int as failed,
          count(*) filter (where d.status in ('PENDING','ASSIGNED','DISPATCHED'))::int as open,
          round(avg(extract(epoch from d.delivered_at - d.dispatched_at) / 3600) filter (where d.delivered_at is not null and d.dispatched_at is not null)::numeric, 1)::text as avg_hours
        from deliveries d join orders o on o.id = d.order_id left join delivery_zones z on z.id = d.zone_id
        where o.placed_at >= ${r.from} and o.placed_at < ${r.to} group by 1 order by total desc`);
      const out = rs.map((x) => ({ ...x, success: n(x.delivered) + n(x.failed) ? n(x.delivered) / (n(x.delivered) + n(x.failed)) : null, avg_hours: x.avg_hours ?? "" }));
      return {
        columns: [t("Zone", "label"), i("Deliveries", "total"), i("Delivered", "delivered"), i("Failed or returned", "failed"), i("Still open", "open"), p("Success rate", "success"), t("Average hours", "avg_hours")],
        rows: out,
        totals: { label: "Total", ...sum(out, ["total", "delivered", "failed", "open"]) },
      };
    },
  },
  {
    key: "feedback",
    title: "Feedback and support",
    group: "Customers & service",
    perm: "reports.sales",
    description: "Reviews and support requests received in the period.",
    usesRange: true,
    run: async (r) => {
      const rv = await rows(sql`select 'Reviews: ' || lower(type::text) as label, count(*)::int as count, round(avg(rating)::numeric, 2)::text as avg,
          count(*) filter (where rating <= 2)::int as low, count(*) filter (where status = 'APPROVED')::int as published, count(*) filter (where status in ('PENDING','FLAGGED'))::int as waiting
        from reviews where created_at >= ${r.from} and created_at < ${r.to} group by type order by 1`);
      const tk = await rows(sql`select 'Support: ' || lower(replace(category::text, '_', ' ')) as label, count(*)::int as count, round(avg(satisfaction)::numeric, 2)::text as avg,
          null::int as low, count(*) filter (where status in ('RESOLVED','CLOSED'))::int as published, count(*) filter (where status in ('OPEN','IN_PROGRESS'))::int as waiting
        from support_tickets where created_at >= ${r.from} and created_at < ${r.to} group by category order by 1`);
      const out = [...rv, ...tk].map((x) => ({ ...x, avg: x.avg ?? "" }));
      return {
        columns: [t("Type", "label"), i("Received", "count"), t("Average rating (1–5)", "avg"), i("Rated 1–2", "low"), i("Published / resolved", "published"), i("Waiting", "waiting")],
        rows: out,
        totals: { label: "Total", ...sum(out, ["count", "waiting"]) },
        notes: ["For support requests, the rating column is the customer's satisfaction score where they gave one."],
      };
    },
  },
];

export function findReport(key: string | undefined) {
  return REPORTS.find((r) => r.key === key);
}
