import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { canAccessOrder } from "@/lib/order-access";
import { handleStkCallback, mpesaMode } from "@/lib/payments/mpesa";

/**
 * Development only: plays the part of the customer's phone. Sends the same callback payload Safaricom
 * would, through the same handler. Disabled unless MPESA_ENV=simulator (and never in production unless
 * ALLOW_PAYMENT_SIMULATOR=true for a staging site).
 */
export async function POST(req: Request) {
  if (mpesaMode() !== "simulator") return new Response("Not found", { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { attemptId?: string; outcome?: string; key?: string };
  const attempt = body.attemptId ? await db.query.paymentAttempts.findFirst({ where: eq(schema.paymentAttempts.id, body.attemptId), with: { order: true } }) : null;
  if (!attempt || !attempt.checkoutRequestId || !(await canAccessOrder(attempt.order, body.key))) return new Response("Not found", { status: 404 });
  const codes: Record<string, [number, string]> = {
    success: [0, "The service request is processed successfully."],
    cancel: [1032, "Request cancelled by user"],
    insufficient: [1, "The balance is insufficient for the transaction"],
    timeout: [1037, "DS timeout user cannot be reached"],
  };
  const [code, desc] = codes[body.outcome ?? ""] ?? codes.cancel;
  const receipt = `SIM${Math.random().toString(36).slice(2, 9).toUpperCase()}`;
  const outcome = await handleStkCallback(
    {
      Body: {
        stkCallback: {
          MerchantRequestID: attempt.merchantRequestId ?? "SIM",
          CheckoutRequestID: attempt.checkoutRequestId,
          ResultCode: code,
          ResultDesc: desc,
          ...(code === 0
            ? {
                CallbackMetadata: {
                  Item: [
                    { Name: "Amount", Value: attempt.amountCents / 100 },
                    { Name: "MpesaReceiptNumber", Value: receipt },
                    { Name: "TransactionDate", Value: Number(new Date().toISOString().replace(/\D/g, "").slice(0, 14)) },
                    { Name: "PhoneNumber", Value: Number(attempt.phone) },
                  ],
                },
              }
            : {}),
        },
      },
    },
    { ip: "simulator", provider: "mpesa_simulator" },
  );
  return Response.json({ outcome });
}
