/** E. Refunds: new records only, stock returned by condition, credit notes, limits, payout tracking. */
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db, schema } from "@/db";
import { getDefaultLocationId } from "@/lib/inventory";
import { completePosSale, expectedCash, openShift } from "@/lib/pos";
import { issueRefund, markRefundPaidOut } from "@/lib/refunds";
import { balance, makeProduct, makeUser } from "../fixtures";

let manager: Awaited<ReturnType<typeof makeUser>>;
let sessionId: string;

beforeAll(async () => {
  manager = await makeUser("MANAGER");
  sessionId = (await openShift({ cashierId: manager.id, locationId: await getDefaultLocationId(), openingFloatCents: 50000 })).id;
});

async function sell(priceKes: number, qty: number) {
  const p = await makeProduct({ priceKes, stock: 10 });
  const r = await completePosSale({ idempotencyKey: randomUUID(), sessionId, cashier: { id: manager.id, permissions: manager.permissions }, customerId: null, lines: [{ variantId: p.variant.id, qty }], manualDiscountCents: 0, payments: [{ method: "CASH", amountCents: priceKes * qty * 100 }] });
  const item = (await db.query.orderItems.findFirst({ where: eq(schema.orderItems.orderId, r.order.id) }))!;
  return { ...p, order: r.order, item };
}

const base = { extraCents: 0, method: "CASH" as const, reference: null, reason: "Customer changed mind", payoutPending: false };

describe("E. refunds", () => {
  it("refunds part of a sale, restocks resellable items, issues a credit note and pays out of the drawer", async () => {
    const { variant, order, item } = await sell(400, 3);
    const drawerBefore = await expectedCash(sessionId);
    const input = { ...base, orderId: order.id, idempotencyKey: randomUUID(), items: [{ orderItemId: item.id, qty: 1, condition: "RESELLABLE" as const }], userId: manager.id, posSessionId: sessionId };
    const refund = await issueRefund(input);
    expect(refund.amountCents).toBe(40000);
    expect(await balance(variant.id)).toMatchObject({ onHand: 8 });
    const o = await db.query.orders.findFirst({ where: eq(schema.orders.id, order.id) });
    expect(o).toMatchObject({ status: "PARTIALLY_REFUNDED", refundedCents: 40000, totalCents: 120000 });
    expect(await expectedCash(sessionId)).toBe(drawerBefore - 40000);
    const note = await db.query.documents.findFirst({ where: and(eq(schema.documents.refundId, refund.id), eq(schema.documents.type, "CREDIT_NOTE")) });
    expect(note).toBeTruthy();

    // Same request again (retry) returns the same refund.
    const again = await issueRefund(input);
    expect(again.id).toBe(refund.id);
    expect((await db.query.orders.findFirst({ where: eq(schema.orders.id, order.id) }))?.refundedCents).toBe(40000);
  });

  it("sends damaged returns to quarantine and won't refund more than was paid", async () => {
    const { variant, order, item } = await sell(500, 2);
    await issueRefund({ ...base, orderId: order.id, idempotencyKey: randomUUID(), items: [{ orderItemId: item.id, qty: 1, condition: "DAMAGED" }], userId: manager.id });
    expect(await balance(variant.id)).toMatchObject({ onHand: 8, quarantined: 1 });
    await expect(issueRefund({ ...base, orderId: order.id, idempotencyKey: randomUUID(), items: [{ orderItemId: item.id, qty: 2, condition: "NOT_RETURNED" }], userId: manager.id })).rejects.toThrow();
    await expect(issueRefund({ ...base, orderId: order.id, idempotencyKey: randomUUID(), items: [], extraCents: 60000, userId: manager.id })).rejects.toThrow(/can be refunded/);
  });

  it("tracks M-Pesa refunds as payout pending until staff confirm the money was sent", async () => {
    const { order, item } = await sell(300, 1);
    const r = await issueRefund({ ...base, method: "MPESA", payoutPending: true, orderId: order.id, idempotencyKey: randomUUID(), items: [{ orderItemId: item.id, qty: 1, condition: "NOT_RETURNED" }], userId: manager.id });
    expect(r.status).toBe("PENDING_PAYOUT");
    await markRefundPaidOut(r.id, "RFD12345XY", manager.id);
    expect((await db.query.refunds.findFirst({ where: eq(schema.refunds.id, r.id) }))?.status).toBe("COMPLETED");
    expect((await db.query.orders.findFirst({ where: eq(schema.orders.id, order.id) }))?.status).toBe("REFUNDED");
  });

  it("financial records can't be deleted or rewritten", async () => {
    const { order, item } = await sell(250, 1);
    const r = await issueRefund({ ...base, orderId: order.id, idempotencyKey: randomUUID(), items: [{ orderItemId: item.id, qty: 1, condition: "RESELLABLE" }], userId: manager.id });
    await expect(db.execute(sql`delete from refunds where id = ${r.id}`)).rejects.toThrow();
    await expect(db.execute(sql`update payments set amount_cents = 1 where order_id = ${order.id}`)).rejects.toThrow();
    await expect(db.execute(sql`delete from payments where order_id = ${order.id}`)).rejects.toThrow();
    await expect(db.execute(sql`delete from audit_logs`)).rejects.toThrow();
  });
});
