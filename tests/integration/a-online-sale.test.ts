/** A. Online sale: server-side pricing, stock reservation, M-Pesa confirmation, stock commit, receipt. */
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db, schema } from "@/db";
import { placeOnlineOrder } from "@/lib/orders";
import { handleStkCallback, initiateStkPush } from "@/lib/payments/mpesa";
import { balance, guestCheckout, makeProduct, movements, stkCallback } from "../fixtures";

describe("A. online sale", () => {
  it("refuses an order whose total doesn't match the server's price", async () => {
    const { variant, locationId } = await makeProduct({ priceKes: 650, stock: 5 });
    await expect(placeOnlineOrder(guestCheckout(variant.id, 2, 100, locationId))).rejects.toThrow(/total changed/i);
    expect((await balance(variant.id)).reserved).toBe(0);
  });

  it("reserves stock, takes M-Pesa payment, commits stock once and issues a receipt", async () => {
    const { variant, locationId } = await makeProduct({ priceKes: 650, stock: 5 });
    const input = guestCheckout(variant.id, 2, 130000, locationId);
    const { order } = await placeOnlineOrder(input);
    expect(order.totalCents).toBe(130000);
    expect(order.status).toBe("AWAITING_PAYMENT");
    expect(await balance(variant.id)).toMatchObject({ onHand: 5, reserved: 2, available: 3 });

    // Submitting the same checkout twice (double click, retry) returns the same order.
    const again = await placeOnlineOrder(input);
    expect(again.duplicate).toBe(true);
    expect(again.order.id).toBe(order.id);
    expect((await balance(variant.id)).reserved).toBe(2);

    const stk = await initiateStkPush(order.id, "254712345678");
    const outcome = await handleStkCallback(stkCallback(stk.checkoutRequestId, 0, { amountKes: 1300 }), { ip: null, provider: "test" });
    expect(outcome).toBe("processed:succeeded");

    const paid = await db.query.orders.findFirst({ where: eq(schema.orders.id, order.id) });
    expect(paid).toMatchObject({ status: "PAID", paymentStatus: "PAID", amountPaidCents: 130000, stockState: "COMMITTED" });
    expect(await balance(variant.id)).toMatchObject({ onHand: 3, reserved: 0 });
    const sales = (await movements(variant.id)).filter((m) => m.type === "SALE");
    expect(sales).toHaveLength(1);
    expect(sales[0].onHandDelta).toBe(-2);

    const receipt = await db.query.documents.findFirst({ where: and(eq(schema.documents.orderId, order.id), eq(schema.documents.type, "RECEIPT")) });
    expect(receipt?.number).toMatch(/^RCT-/);
    const payments = await db.query.payments.findMany({ where: eq(schema.payments.orderId, order.id) });
    expect(payments).toHaveLength(1);
    expect(payments[0].amountCents).toBe(130000);
  });

  it("never sells more than is in stock when two customers race for the last unit", async () => {
    const { variant, locationId } = await makeProduct({ priceKes: 400, stock: 1 });
    const results = await Promise.allSettled([placeOnlineOrder(guestCheckout(variant.id, 1, 40000, locationId)), placeOnlineOrder(guestCheckout(variant.id, 1, 40000, locationId))]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await balance(variant.id)).toMatchObject({ onHand: 1, reserved: 1, available: 0 });
  });
});
