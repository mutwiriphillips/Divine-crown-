import { callbackIpAllowed, handleStkCallback, verifyCallbackSecret, type StkCallback } from "@/lib/payments/mpesa";

/**
 * Safaricom posts STK results here. The path secret, optional IP allow-list, attempt matching,
 * amount check and (in live modes) an STK status query guard against forged callbacks.
 * Always answers 200 with Daraja's expected body once the payload is logged, so Safaricom doesn't retry forever.
 */
export async function POST(req: Request, { params }: { params: Promise<{ secret: string }> }) {
  const { secret } = await params;
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;
  if (!verifyCallbackSecret(secret) || !callbackIpAllowed(ip)) return new Response("Not found", { status: 404 });
  let payload: StkCallback;
  try {
    payload = (await req.json()) as StkCallback;
  } catch {
    return Response.json({ ResultCode: 1, ResultDesc: "Invalid JSON" }, { status: 400 });
  }
  try {
    await handleStkCallback(payload, { ip, provider: "mpesa_daraja" });
  } catch (e) {
    console.error("M-Pesa callback processing failed", e);
    // Ask Safaricom to retry; processing is idempotent.
    return Response.json({ ResultCode: 1, ResultDesc: "Temporary error" }, { status: 500 });
  }
  return Response.json({ ResultCode: 0, ResultDesc: "Accepted" });
}
