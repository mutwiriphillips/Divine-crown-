/** B. Failed and pending payments: nothing is marked paid without a confirmed payment. */
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db, schema } from "@/db";
import { expireUnpaidOrders, placeOnlineOrder } from "@/lib/orders";
import { handleStkCallback, initiateStkPush } from "@/lib/payments/mpesa";
import { balance, guestCheckout, makeProduct, stkCallback } from "../fixtures";

const getOrder = (id: string) => db.query.orders.findFirst({ where: eq(schema.orders.id, id) });

describe("B. failed and pending payments", () => {
  it("a cancelled prompt leaves the order unpaid with stock still held, and the customer can retry", async () => {
    const { variant, locationId } = await makeProduct({ priceKes: 300, stock: 4 });
    const { order } = await placeOnlineOrder(guestCheckout(variant.id, 1, 30000, locationId));
    const first = await initiateStkPush(order.id, "254712345678");
    expect((await getOrder(order.id))?.paymentStatus).toBe("PENDING");

    expect(await handleStkCallback(stkCallback(first.checkoutRequestId, 1032), { ip: null, provider: "test" })).toBe("processed:cancelled");
    expect(await getOrder(order.id)).toMatchObject({ status: "AWAITING_PAYMENT", paymentStatus: "FAILED", amountPaidCents: 0 });
    expect((await balance(variant.id)).reserved).toBe(1);
    expect(await db.query.payments.findMany({ where: eq(schema.payments.orderId, order.id) })).toHaveLength(0);

    const second = await initiateStkPush(order.id, "254712345678");
    expect(await handleStkCallback(stkCallback(second.checkoutRequestId, 0, { amountKes: 300 }), { ip: null, provider: "test" })).toBe("processed:succeeded");
    expect((await getOrder(order.id))?.status).toBe("PAID");
  });

  it("blocks a second prompt while one is still pending", async () => {
    const { variant, locationId } = await makeProduct({ priceKes: 300, stock: 4 });
    const { order } = await placeOnlineOrder(guestCheckout(variant.id, 1, 30000, locationId));
    await initiateStkPush(order.id, "254712345678");
    await expect(initiateStkPush(order.id, "254712345678")).rejects.toThrow(/just sent/i);
  });

  it("records an underpayment without marking the order paid", async () => {
    const { variant, locationId } = await makeProduct({ priceKes: 500, stock: 2 });
    const { order } = await placeOnlineOrder(guestCheckout(variant.id, 1, 50000, locationId));
    const stk = await initiateStkPush(order.id, "254712345678");
    await handleStkCallback(stkCallback(stk.checkoutRequestId, 0, { amountKes: 200 }), { ip: null, provider: "test" });
    const o = await getOrder(order.id);
    expect(o?.amountPaidCents).toBe(20000);
    expect(o?.paymentStatus).toBe("PARTIALLY_PAID");
    expect(o?.status).not.toBe("PAID");
  });

  it("rejects malformed and unknown callbacks", async () => {
    expect(await handleStkCallback({} as never, { ip: null, provider: "test" })).toBe("rejected:malformed");
    expect(await handleStkCallback(stkCallback("ws_UNKNOWN", 0, { amountKes: 100 }), { ip: null, provider: "test" })).toBe("rejected:unknown_checkout_request");
  });

  it("cancels unpaid orders after the reservation window and returns the stock", async () => {
    const { variant, locationId } = await makeProduct({ priceKes: 250, stock: 3 });
    const { order } = await placeOnlineOrder(guestCheckout(variant.id, 2, 50000, locationId));
    expect((await balance(variant.id)).reserved).toBe(2);
    await expireUnpaidOrders(new Date(Date.now() + 3 * 86400_000));
    expect((await getOrder(order.id))?.status).toBe("CANCELLED");
    expect(await balance(variant.id)).toMatchObject({ onHand: 3, reserved: 0 });
  });
});
