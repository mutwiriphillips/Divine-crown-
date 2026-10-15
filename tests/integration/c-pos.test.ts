/** C. Point of sale: shift, sale, change, split payment, duplicate submit, drawer reconciliation. */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db, schema } from "@/db";
import { getDefaultLocationId } from "@/lib/inventory";
import { closeShift, completePosSale, expectedCash, openShift } from "@/lib/pos";
import { balance, makeProduct, makeUser } from "../fixtures";

let cashier: Awaited<ReturnType<typeof makeUser>>;
let sessionId: string;

beforeAll(async () => {
  cashier = await makeUser("CASHIER");
  const s = await openShift({ cashierId: cashier.id, locationId: await getDefaultLocationId(), openingFloatCents: 100000 });
  sessionId = s.id;
});

const sale = (lines: { variantId: string; qty: number }[], payments: { method: "CASH" | "MPESA" | "CARD"; amountCents: number; reference?: string }[], extra: Record<string, unknown> = {}) => ({
  idempotencyKey: randomUUID(),
  sessionId,
  cashier: { id: cashier.id, permissions: cashier.permissions },
  customerId: null,
  lines,
  manualDiscountCents: 0,
  payments,
  ...extra,
});

describe("C. point of sale", () => {
  it("never opens a second shift for the same cashier", async () => {
    const again = await openShift({ cashierId: cashier.id, locationId: await getDefaultLocationId(), openingFloatCents: 0 });
    expect(again.id).toBe(sessionId);
    // The database also enforces one open shift per cashier.
    await expect(db.insert(schema.posSessions).values({ cashierId: cashier.id, locationId: await getDefaultLocationId(), openingFloatCents: 0 })).rejects.toThrow();
  });

  it("completes a cash sale with change, deducts stock and records the drawer movement", async () => {
    const { variant } = await makeProduct({ priceKes: 300, stock: 10 });
    const before = await expectedCash(sessionId);
    const input = sale([{ variantId: variant.id, qty: 2 }], [{ method: "CASH", amountCents: 100000 }]);
    const r = await completePosSale(input);
    expect(r.order.totalCents).toBe(60000);
    expect(r.changeCents).toBe(40000);
    expect(r.order.status).toBe("COMPLETED");
    expect(r.receiptId).toBeTruthy();
    expect((await balance(variant.id)).onHand).toBe(8);
    expect(await expectedCash(sessionId)).toBe(before + 60000);

    // A repeated submit (double tap, network retry) must not sell twice.
    const again = await completePosSale(input);
    expect(again.duplicate).toBe(true);
    expect((await balance(variant.id)).onHand).toBe(8);
  });

  it("refuses a short payment and card/M-Pesa amounts above the total", async () => {
    const { variant } = await makeProduct({ priceKes: 300, stock: 5 });
    await expect(completePosSale(sale([{ variantId: variant.id, qty: 1 }], [{ method: "CASH", amountCents: 20000 }]))).rejects.toThrow(/short/);
    await expect(completePosSale(sale([{ variantId: variant.id, qty: 1 }], [{ method: "CARD", amountCents: 50000 }]))).rejects.toThrow(/more than the total/);
    expect((await balance(variant.id)).onHand).toBe(5);
  });

  it("takes a split cash + M-Pesa payment and rejects a reused M-Pesa code", async () => {
    const { variant } = await makeProduct({ priceKes: 1000, stock: 5 });
    const code = `QK${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
    const r = await completePosSale(sale([{ variantId: variant.id, qty: 1 }], [{ method: "MPESA", amountCents: 60000, reference: code }, { method: "CASH", amountCents: 40000 }]));
    const pays = await db.query.payments.findMany({ where: eq(schema.payments.orderId, r.order.id) });
    expect(pays.map((p) => p.amountCents).sort()).toEqual([40000, 60000]);
    await expect(completePosSale(sale([{ variantId: variant.id, qty: 1 }], [{ method: "MPESA", amountCents: 100000, reference: code }]))).rejects.toThrow(/already been recorded/);
  });

  it("refuses discounts and price changes without permission, and products still under review", async () => {
    const { variant } = await makeProduct({ priceKes: 500, stock: 5 });
    await expect(completePosSale(sale([{ variantId: variant.id, qty: 1 }], [{ method: "CASH", amountCents: 50000 }], { manualDiscountCents: 1000 }))).rejects.toThrow(/permission/);
    await expect(completePosSale(sale([{ variantId: variant.id, qty: 1, overrideUnitCents: 100 } as never], [{ method: "CASH", amountCents: 50000 }]))).rejects.toThrow(/permission/);
    const flagged = await makeProduct({ priceKes: 500, stock: 5, needsReview: true });
    await expect(completePosSale(sale([{ variantId: flagged.variant.id, qty: 1 }], [{ method: "CASH", amountCents: 50000 }]))).rejects.toThrow();
  });

  it("needs a note to close a shift that doesn't balance, and records the variance", async () => {
    const expected = await expectedCash(sessionId);
    await expect(closeShift({ sessionId, countedCents: expected - 5000, note: null, userId: cashier.id, canCloseOthers: false })).rejects.toThrow(/short/);
    const r = await closeShift({ sessionId, countedCents: expected - 5000, note: "Gave wrong change once", userId: cashier.id, canCloseOthers: false });
    expect(r.variance).toBe(-5000);
    const s = await db.query.posSessions.findFirst({ where: and(eq(schema.posSessions.id, sessionId)) });
    expect(s?.status).toBe("CLOSED");
  });
});
