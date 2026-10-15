import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { safeEqual, sha256 } from "@/lib/crypto";
import { formatKES } from "@/lib/money";
import { notify } from "@/lib/notifications";
import { addOrderEvent, DuplicatePaymentError, lockOrder, orderUrl, recordPayment } from "@/lib/orders";

/**
 * M-Pesa STK Push (Lipa na M-Pesa Online) via Safaricom Daraja.
 *
 * MPESA_ENV=simulator  local development: no Safaricom calls; a simulator page fires callbacks through
 *                      the same handler as real ones. Refused when NODE_ENV=production unless
 *                      ALLOW_PAYMENT_SIMULATOR=true (for staging only).
 * MPESA_ENV=sandbox    Daraja sandbox (https://sandbox.safaricom.co.ke) with test credentials.
 * MPESA_ENV=production live Daraja. Requires a Go-Live approved shortcode.
 *
 * Trust model: Daraja callbacks are not signed. We therefore
 *   1. accept callbacks only on a secret URL (MPESA_CALLBACK_SECRET) and optionally an IP allow-list,
 *   2. match them to an attempt we created (CheckoutRequestID), and require the amount to match,
 *   3. in sandbox/production, confirm success with Daraja's STK Query API before marking anything paid,
 *   4. process each attempt at most once (row lock + status check), and each M-Pesa receipt at most once
 *      (unique index on payment method + reference).
 */

export type MpesaMode = "simulator" | "sandbox" | "production" | "disabled";

export function mpesaMode(): MpesaMode {
  const m = (process.env.MPESA_ENV ?? "").toLowerCase();
  if (m === "simulator") {
    if (process.env.NODE_ENV === "production" && process.env.ALLOW_PAYMENT_SIMULATOR !== "true") return "disabled";
    return "simulator";
  }
  if (m === "sandbox" || m === "production") {
    const required = ["MPESA_CONSUMER_KEY", "MPESA_CONSUMER_SECRET", "MPESA_SHORTCODE", "MPESA_PASSKEY", "MPESA_CALLBACK_BASE_URL", "MPESA_CALLBACK_SECRET"];
    if (required.some((k) => !process.env[k])) return "disabled";
    return m;
  }
  return "disabled";
}

function baseUrl() {
  return mpesaMode() === "production" ? "https://api.safaricom.co.ke" : "https://sandbox.safaricom.co.ke";
}

let tokenCache: { token: string; exp: number } | null = null;
async function accessToken(): Promise<string> {
  if (tokenCache && tokenCache.exp > Date.now() + 30_000) return tokenCache.token;
  const auth = Buffer.from(`${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`).toString("base64");
  const res = await fetch(`${baseUrl()}/oauth/v1/generate?grant_type=client_credentials`, { headers: { Authorization: `Basic ${auth}` } });
  if (!res.ok) throw new Error(`M-Pesa auth failed (${res.status})`);
  const j = (await res.json()) as { access_token: string; expires_in: string };
  tokenCache = { token: j.access_token, exp: Date.now() + Number(j.expires_in) * 1000 };
  return j.access_token;
}

function timestamp(d = new Date()) {
  // Daraja expects YYYYMMDDHHmmss in East Africa Time.
  const eat = new Date(d.getTime() + 3 * 3600_000);
  return eat.toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
}

function stkPassword(ts: string) {
  return Buffer.from(`${process.env.MPESA_SHORTCODE}${process.env.MPESA_PASSKEY}${ts}`).toString("base64");
}

export function callbackPath() {
  return `/api/payments/mpesa/callback/${process.env.MPESA_CALLBACK_SECRET ?? "dev-callback"}`;
}

export class PaymentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentError";
  }
}

/** Start an STK push for the order's outstanding balance. */
export async function initiateStkPush(orderId: string, phone: string) {
  const mode = mpesaMode();
  if (mode === "disabled") throw new PaymentError("M-Pesa payments aren't set up yet. Please contact the shop to pay.");
  if (!/^254[17]\d{8}$/.test(phone)) throw new PaymentError("Enter an M-Pesa number like 0712 345 678.");

  const attempt = await db.transaction(async (tx) => {
    const order = await lockOrder(tx, orderId);
    if (!["AWAITING_PAYMENT", "PENDING", "PROCESSING"].includes(order.status) || order.paymentStatus === "PAID") {
      throw new PaymentError("This order doesn't need payment.");
    }
    const due = order.totalCents - order.amountPaidCents;
    if (due <= 0) throw new PaymentError("This order is already paid.");
    if (due % 100 !== 0) throw new PaymentError("Amount must be whole shillings for M-Pesa.");
    const recent = await tx.query.paymentAttempts.findFirst({
      where: and(
        eq(schema.paymentAttempts.orderId, orderId),
        inArray(schema.paymentAttempts.status, ["INITIATED", "PENDING"]),
        sql`${schema.paymentAttempts.createdAt} > now() - interval '60 seconds'`,
      ),
    });
    if (recent) throw new PaymentError("A payment prompt was just sent. Check your phone, or wait a minute before trying again.");
    const [a] = await tx
      .insert(schema.paymentAttempts)
      .values({ orderId, provider: mode === "simulator" ? "mpesa_simulator" : "mpesa_daraja", phone, amountCents: due })
      .returning();
    // Keep the stock held while the customer is paying.
    if (order.reservationExpiresAt && order.reservationExpiresAt.getTime() < Date.now() + 5 * 60_000) {
      await tx.update(schema.orders).set({ reservationExpiresAt: new Date(Date.now() + 5 * 60_000) }).where(eq(schema.orders.id, orderId));
    }
    await tx.update(schema.orders).set({ paymentStatus: "PENDING" }).where(eq(schema.orders.id, orderId));
    return { a, orderNumber: order.number };
  });

  if (mode === "simulator") {
    const checkoutRequestId = `ws_SIM_${attempt.a.id.replace(/-/g, "").slice(0, 20)}`;
    await db
      .update(schema.paymentAttempts)
      .set({ status: "PENDING", checkoutRequestId, merchantRequestId: `SIM-${Date.now()}` })
      .where(eq(schema.paymentAttempts.id, attempt.a.id));
    return { attemptId: attempt.a.id, checkoutRequestId, simulator: true };
  }

  const ts = timestamp();
  const body = {
    BusinessShortCode: process.env.MPESA_SHORTCODE,
    Password: stkPassword(ts),
    Timestamp: ts,
    TransactionType: process.env.MPESA_TRANSACTION_TYPE ?? "CustomerPayBillOnline",
    Amount: Math.round(attempt.a.amountCents / 100),
    PartyA: phone,
    PartyB: process.env.MPESA_PARTY_B ?? process.env.MPESA_SHORTCODE,
    PhoneNumber: phone,
    CallBackURL: `${process.env.MPESA_CALLBACK_BASE_URL}${callbackPath()}`,
    AccountReference: attempt.orderNumber.slice(0, 12),
    TransactionDesc: `Order ${attempt.orderNumber}`.slice(0, 13),
  };
  try {
    const res = await fetch(`${baseUrl()}/mpesa/stkpush/v1/processrequest`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = (await res.json()) as { ResponseCode?: string; CheckoutRequestID?: string; MerchantRequestID?: string; errorMessage?: string; ResponseDescription?: string };
    if (!res.ok || j.ResponseCode !== "0" || !j.CheckoutRequestID) {
      await db
        .update(schema.paymentAttempts)
        .set({ status: "FAILED", resultDesc: (j.errorMessage ?? j.ResponseDescription ?? `HTTP ${res.status}`).slice(0, 300), completedAt: new Date() })
        .where(eq(schema.paymentAttempts.id, attempt.a.id));
      await db.update(schema.orders).set({ paymentStatus: "FAILED" }).where(eq(schema.orders.id, orderId));
      throw new PaymentError("M-Pesa couldn't send the payment prompt. Check the number and try again.");
    }
    await db
      .update(schema.paymentAttempts)
      .set({ status: "PENDING", checkoutRequestId: j.CheckoutRequestID, merchantRequestId: j.MerchantRequestID ?? null })
      .where(eq(schema.paymentAttempts.id, attempt.a.id));
    return { attemptId: attempt.a.id, checkoutRequestId: j.CheckoutRequestID, simulator: false };
  } catch (e) {
    if (e instanceof PaymentError) throw e;
    await db
      .update(schema.paymentAttempts)
      .set({ status: "FAILED", resultDesc: "Network error contacting M-Pesa", completedAt: new Date() })
      .where(eq(schema.paymentAttempts.id, attempt.a.id));
    throw new PaymentError("We couldn't reach M-Pesa. Try again in a moment.");
  }
}

/** Ask Daraja for the authoritative result of an STK push. */
export async function queryStkStatus(checkoutRequestId: string): Promise<{ resultCode: string; resultDesc: string } | null> {
  const mode = mpesaMode();
  if (mode !== "sandbox" && mode !== "production") return null;
  const ts = timestamp();
  const res = await fetch(`${baseUrl()}/mpesa/stkpushquery/v1/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ BusinessShortCode: process.env.MPESA_SHORTCODE, Password: stkPassword(ts), Timestamp: ts, CheckoutRequestID: checkoutRequestId }),
  });
  const j = (await res.json()) as { ResultCode?: string; ResultDesc?: string; errorCode?: string };
  // While the customer hasn't answered, Daraja returns an error such as "The transaction is being processed".
  if (j.ResultCode === undefined) return null;
  return { resultCode: String(j.ResultCode), resultDesc: j.ResultDesc ?? "" };
}

export type StkCallback = {
  Body?: {
    stkCallback?: {
      MerchantRequestID?: string;
      CheckoutRequestID?: string;
      ResultCode?: number | string;
      ResultDesc?: string;
      CallbackMetadata?: { Item?: { Name: string; Value?: string | number }[] };
    };
  };
};

export function verifyCallbackSecret(given: string): boolean {
  const expected = process.env.MPESA_CALLBACK_SECRET ?? (mpesaMode() === "simulator" ? "dev-callback" : "");
  return !!expected && safeEqual(given, expected);
}

export function callbackIpAllowed(ip: string | null): boolean {
  const list = (process.env.MPESA_ALLOWED_IPS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (list.length === 0) return true;
  return !!ip && list.includes(ip);
}

/**
 * Process an STK callback. Safe to call any number of times with the same payload.
 * Returns a short outcome string for the callback log.
 */
export async function handleStkCallback(payload: StkCallback, meta: { ip: string | null; provider: string; skipQuery?: boolean }): Promise<string> {
  const cb = payload?.Body?.stkCallback;
  const checkoutRequestId = cb?.CheckoutRequestID ?? null;
  const payloadHash = sha256(JSON.stringify(payload ?? {}));
  const logOutcome = async (outcome: string) => {
    await db.insert(schema.paymentCallbackLogs).values({ provider: meta.provider, checkoutRequestId, payloadHash, payload: payload ?? {}, outcome, ip: meta.ip });
    return outcome;
  };
  if (!cb || !checkoutRequestId || cb.ResultCode === undefined) return logOutcome("rejected:malformed");

  const items = Object.fromEntries((cb.CallbackMetadata?.Item ?? []).map((i) => [i.Name, i.Value]));
  const resultCode = String(cb.ResultCode);

  // In live modes, never trust the callback body alone for success.
  let verified = resultCode === "0";
  if (verified && !meta.skipQuery && (mpesaMode() === "sandbox" || mpesaMode() === "production")) {
    const q = await queryStkStatus(checkoutRequestId).catch(() => null);
    if (!q) return logOutcome("deferred:query_unavailable"); // the reconciliation job will retry
    verified = q.resultCode === "0";
    if (!verified) return logOutcome(`rejected:query_says_${q.resultCode}`);
  }

  const outcome = await db.transaction(async (tx) => {
    const rows = await tx.select().from(schema.paymentAttempts).where(eq(schema.paymentAttempts.checkoutRequestId, checkoutRequestId)).for("update");
    const attempt = rows[0];
    if (!attempt) return "rejected:unknown_checkout_request";
    if (attempt.status === "SUCCEEDED" || attempt.status === "FAILED" || attempt.status === "CANCELLED") return "duplicate";

    if (resultCode !== "0") {
      const status = resultCode === "1032" ? "CANCELLED" : resultCode === "1037" ? "EXPIRED" : "FAILED";
      await tx
        .update(schema.paymentAttempts)
        .set({ status, resultCode, resultDesc: cb.ResultDesc?.slice(0, 300) ?? null, completedAt: new Date() })
        .where(eq(schema.paymentAttempts.id, attempt.id));
      const order = await lockOrder(tx, attempt.orderId);
      if (order.amountPaidCents === 0) await tx.update(schema.orders).set({ paymentStatus: "FAILED" }).where(eq(schema.orders.id, order.id));
      await addOrderEvent(tx, { orderId: order.id, type: "payment", message: `M-Pesa payment not completed: ${cb.ResultDesc ?? resultCode}.` });
      await notify(tx, {
        event: "payment.failed",
        entityType: "payment_attempt",
        entityId: attempt.id,
        to: { customerId: order.customerId, name: order.contactName, email: order.contactEmail, phone: order.contactPhone },
        vars: { orderNumber: order.number, reason: status === "CANCELLED" ? "cancelled on the phone" : status === "EXPIRED" ? "the prompt timed out" : "declined", orderUrl: orderUrl(order) },
      });
      return `processed:${status.toLowerCase()}`;
    }

    const amountCents = Math.round(Number(items.Amount ?? 0) * 100);
    const receipt = String(items.MpesaReceiptNumber ?? "").trim();
    if (!receipt) return "rejected:no_receipt";
    if (amountCents !== attempt.amountCents) {
      // Money did arrive, but not the amount we asked for: record what was paid and flag it.
      await tx
        .update(schema.paymentAttempts)
        .set({ status: "SUCCEEDED", resultCode, resultDesc: `Amount mismatch: expected ${formatKES(attempt.amountCents)}, got ${formatKES(amountCents)}`, providerReceipt: receipt, completedAt: new Date() })
        .where(eq(schema.paymentAttempts.id, attempt.id));
    } else {
      await tx
        .update(schema.paymentAttempts)
        .set({ status: "SUCCEEDED", resultCode, resultDesc: cb.ResultDesc?.slice(0, 300) ?? null, providerReceipt: receipt, completedAt: new Date() })
        .where(eq(schema.paymentAttempts.id, attempt.id));
    }
    if (amountCents <= 0) return "rejected:zero_amount";
    try {
      await recordPayment(tx, {
        orderId: attempt.orderId,
        method: "MPESA",
        amountCents,
        reference: receipt,
        attemptId: attempt.id,
        note: amountCents !== attempt.amountCents ? "Amount differed from the request; check the balance." : null,
      });
    } catch (e) {
      if (e instanceof DuplicatePaymentError) {
        // Same M-Pesa receipt already recorded elsewhere: don't count the money twice, but leave a trail for staff.
        await addOrderEvent(tx, { orderId: attempt.orderId, type: "payment", message: `M-Pesa receipt ${receipt} was already recorded on another payment. Check the M-Pesa statement before marking this order paid.` });
        return "duplicate:receipt";
      }
      throw e;
    }
    return "processed:succeeded";
  });
  return logOutcome(outcome);
}

/**
 * Reconciliation: re-check attempts that never received a callback. Run every few minutes by the worker,
 * and on demand from Admin → Payments.
 */
export async function reconcilePendingAttempts(olderThanSeconds = 90) {
  const mode = mpesaMode();
  const stale = await db
    .select()
    .from(schema.paymentAttempts)
    .where(and(eq(schema.paymentAttempts.status, "PENDING"), lt(schema.paymentAttempts.createdAt, new Date(Date.now() - olderThanSeconds * 1000))))
    .limit(50);
  let resolved = 0;
  for (const a of stale) {
    if (!a.checkoutRequestId) continue;
    if (mode === "simulator") {
      // Simulated prompts that nobody answered time out like real ones.
      if (Date.now() - a.createdAt.getTime() > 3 * 60_000) {
        await handleStkCallback(
          { Body: { stkCallback: { CheckoutRequestID: a.checkoutRequestId, ResultCode: 1037, ResultDesc: "No response from user (simulated timeout)" } } },
          { ip: null, provider: "reconciliation" },
        );
        resolved++;
      }
      continue;
    }
    const q = await queryStkStatus(a.checkoutRequestId).catch(() => null);
    await db.update(schema.paymentAttempts).set({ lastQueriedAt: new Date() }).where(eq(schema.paymentAttempts.id, a.id));
    if (!q) continue;
    if (q.resultCode === "0") {
      if (a.resultDesc === "Confirmed by query; awaiting receipt number") continue;
      // The query confirms success but doesn't return the receipt number; flag for manual matching
      // if the callback never arrives. Staff record it with the M-Pesa code from the statement.
      await db.transaction(async (tx) => {
        await addOrderEvent(tx, { orderId: a.orderId, type: "payment", message: "M-Pesa reports this payment succeeded but no confirmation callback arrived. Match the M-Pesa code from the statement and record it." });
      });
      await db.update(schema.paymentAttempts).set({ resultDesc: "Confirmed by query; awaiting receipt number" }).where(eq(schema.paymentAttempts.id, a.id));
    } else {
      await handleStkCallback(
        { Body: { stkCallback: { CheckoutRequestID: a.checkoutRequestId, ResultCode: q.resultCode, ResultDesc: q.resultDesc } } },
        { ip: null, provider: "reconciliation", skipQuery: true },
      );
      resolved++;
    }
  }
  return resolved;
}
