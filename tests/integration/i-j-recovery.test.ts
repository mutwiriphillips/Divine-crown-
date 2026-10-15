/** I. Repeated callbacks and J. failed notifications: retries never double-charge or lose the sale. */
import { eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db, schema } from "@/db";
import { placeOnlineOrder } from "@/lib/orders";
import { handleStkCallback, initiateStkPush } from "@/lib/payments/mpesa";
import { processJobs } from "@/lib/worker-tasks";
import { balance, guestCheckout, makeProduct, movements, stkCallback } from "../fixtures";

async function paidOrder() {
  const { variant, locationId } = await makeProduct({ priceKes: 800, stock: 5 });
  const { order } = await placeOnlineOrder(guestCheckout(variant.id, 1, 80000, locationId));
  const stk = await initiateStkPush(order.id, "254712345678");
  const payload = stkCallback(stk.checkoutRequestId, 0, { amountKes: 800 });
  return { order, variant, payload };
}

describe("I. repeated M-Pesa callbacks", () => {
  it("processes the same callback once, however many times it arrives (including concurrently)", async () => {
    const { order, variant, payload } = await paidOrder();
    const outcomes = await Promise.all([1, 2, 3].map(() => handleStkCallback(payload, { ip: null, provider: "test" })));
    expect(outcomes.filter((o) => o === "processed:succeeded")).toHaveLength(1);
    expect(await handleStkCallback(payload, { ip: null, provider: "test" })).toBe("duplicate");

    expect(await db.query.payments.findMany({ where: eq(schema.payments.orderId, order.id) })).toHaveLength(1);
    expect((await db.query.orders.findFirst({ where: eq(schema.orders.id, order.id) }))?.amountPaidCents).toBe(80000);
    expect((await movements(variant.id)).filter((m) => m.type === "SALE")).toHaveLength(1);
    expect((await balance(variant.id)).onHand).toBe(4);
    const receipts = await db.query.documents.findMany({ where: eq(schema.documents.orderId, order.id) });
    expect(receipts.filter((d) => d.type === "RECEIPT")).toHaveLength(1);
    // Every delivery is logged for audit.
    const logs = await db.execute(sql`select count(*)::int as n from payment_callback_logs where checkout_request_id = ${payload.Body.stkCallback.CheckoutRequestID}`);
    expect(Number(logs.rows[0].n)).toBe(4);
  });
});

describe("J. failed notifications", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
  });

  it("a provider outage is retried with backoff and never undoes the sale", async () => {
    process.env.RESEND_API_KEY = "test-key";
    process.env.EMAIL_FROM = "shop@test.local";
    const fetchMock = vi.fn(async () => new Response("provider down", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    const { order, payload } = await paidOrder();
    await handleStkCallback(payload, { ip: null, provider: "test" });
    const email = await db.query.notifications.findFirst({ where: (n, { and, eq }) => and(eq(n.entityId, order.id), eq(n.channel, "EMAIL")) });
    expect(email).toBeTruthy();
    // Only run this notification's job, so other tests' queued jobs don't interfere.
    await db.execute(sql`update jobs set run_at = now() + interval '1 day' where status = 'QUEUED' and not (payload->>'notificationId' = ${email!.id})`);
    await db.execute(sql`update jobs set run_at = now() where payload->>'notificationId' = ${email!.id}`);

    await processJobs("test-worker");
    expect(fetchMock).toHaveBeenCalled();
    const afterFail = await db.query.notifications.findFirst({ where: eq(schema.notifications.id, email!.id) });
    expect(afterFail?.status).toBe("QUEUED");
    expect(afterFail?.lastError).toMatch(/503/);
    const job = (await db.execute(sql`select status, attempts, run_at > now() as later from jobs where payload->>'notificationId' = ${email!.id}`)).rows[0];
    expect(job).toMatchObject({ status: "QUEUED", attempts: 1, later: true });
    expect((await db.query.orders.findFirst({ where: eq(schema.orders.id, order.id) }))?.status).toBe("PAID");

    // Provider recovers; the retry sends it.
    fetchMock.mockImplementation(async () => Response.json({ id: "msg_1" }));
    await db.execute(sql`update jobs set run_at = now() where payload->>'notificationId' = ${email!.id}`);
    await processJobs("test-worker");
    expect((await db.query.notifications.findFirst({ where: eq(schema.notifications.id, email!.id) }))?.status).toBe("SENT");
  });
});
