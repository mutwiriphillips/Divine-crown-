/** H. Report reconciliation: every report agrees with the underlying records and with each other. */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { getDefaultLocationId } from "@/lib/inventory";
import { completePosSale, openShift } from "@/lib/pos";
import { issueRefund } from "@/lib/refunds";
import { findReport, REPORTS } from "@/lib/report-defs";
import { COUNTED, presetRange, salesByDimension, salesSummary } from "@/lib/reports";
import { makeProduct, makeUser } from "../fixtures";

const today = presetRange("today");
const one = async (q: ReturnType<typeof sql>) => Number(Object.values((await db.execute(q)).rows[0])[0] ?? 0);

beforeAll(async () => {
  // Make sure there is activity today, including a discount and a refund, whatever ran before.
  const m = await makeUser("MANAGER");
  const s = await openShift({ cashierId: m.id, locationId: await getDefaultLocationId(), openingFloatCents: 0 });
  const p = await makeProduct({ priceKes: 700, stock: 10, costKes: 400 });
  const r = await completePosSale({ idempotencyKey: randomUUID(), sessionId: s.id, cashier: { id: m.id, permissions: m.permissions }, customerId: null, lines: [{ variantId: p.variant.id, qty: 3 }], manualDiscountCents: 10000, payments: [{ method: "CASH", amountCents: 200000 }] });
  const item = await db.query.orderItems.findFirst({ where: (t, { eq }) => eq(t.orderId, r.order.id) });
  await issueRefund({ orderId: r.order.id, idempotencyKey: randomUUID(), items: [{ orderItemId: item!.id, qty: 1, condition: "RESELLABLE" }], extraCents: 0, method: "CASH", reference: null, reason: "Test refund", payoutPending: false, userId: m.id, posSessionId: s.id });
});

describe("H. report reconciliation", () => {
  it("summary figures match the raw orders, payments and refunds", async () => {
    const s = await salesSummary(today);
    const gross = await one(sql`select coalesce(sum(total_cents),0) from orders where status in ${COUNTED} and placed_at >= ${today.from} and placed_at < ${today.to}`);
    const refunds = await one(sql`select coalesce(sum(amount_cents),0) from refunds where created_at >= ${today.from} and created_at < ${today.to}`);
    expect(s.gross).toBe(gross);
    expect(s.refunds).toBe(refunds);
    expect(s.net).toBe(gross - refunds);
    expect(s.gross).toBeGreaterThan(0);
    expect(s.refunds).toBeGreaterThan(0);
    expect(s.discounts).toBeGreaterThan(0);
  });

  it("breakdowns add up to the total", async () => {
    const s = await salesSummary(today);
    const total = (rows: { amount: number }[]) => rows.reduce((a, r) => a + r.amount, 0);
    expect(total(await salesByDimension(today, "source"))).toBe(s.gross);
    expect(total(await salesByDimension(today, "cashier"))).toBe(s.gross);
    const payments = await one(sql`select coalesce(sum(amount_cents),0) from payments where status = 'SUCCEEDED' and received_at >= ${today.from} and received_at < ${today.to}`);
    expect(total(await salesByDimension(today, "method"))).toBe(payments);
    // Product lines + delivery + order-level discount adjustments = order totals.
    const lines = total(await salesByDimension(today, "product"));
    const delivery = await one(sql`select coalesce(sum(delivery_fee_cents),0) from orders where status in ${COUNTED} and placed_at >= ${today.from} and placed_at < ${today.to}`);
    const orderDisc = await one(sql`select coalesce(sum(discount_cents),0) from orders where status in ${COUNTED} and placed_at >= ${today.from} and placed_at < ${today.to}`);
    const taxExtra = await one(sql`select coalesce(sum(case when tax_inclusive then 0 else tax_cents end),0) from orders where status in ${COUNTED} and placed_at >= ${today.from} and placed_at < ${today.to}`);
    expect(lines + delivery - orderDisc + taxExtra).toBe(s.gross);
  });

  it("the reports page and the CSV export use the same numbers as the dashboard", async () => {
    const s = await salesSummary(today);
    const period = await findReport("sales-period")!.run(today, { grain: "day" });
    expect(period.totals?.gross).toBe(s.gross);
    expect(period.totals?.refunds).toBe(s.refunds);
    expect(period.totals?.net).toBe(s.net);
    const gp = await findReport("gross-profit")!.run(today, {});
    expect(gp.totals?.gp).toBe(s.grossProfit);
  });

  it("every report runs without error", async () => {
    for (const r of REPORTS) {
      const res = await r.run(presetRange("year"), {});
      expect(Array.isArray(res.rows), r.key).toBe(true);
      for (const row of res.rows) for (const c of res.columns) expect(c.key in row, `${r.key}.${c.key}`).toBe(true);
    }
  });
});
