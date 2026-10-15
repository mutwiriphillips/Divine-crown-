import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { hashPassword } from "@/lib/auth/core";
import { getDefaultLocationId, receiveIntoStock } from "@/lib/inventory";
import { ROLE_DEFAULTS } from "@/lib/permissions";

export const uid = () => randomUUID().slice(0, 8);

export async function makeUser(roleKey: keyof typeof ROLE_DEFAULTS | string, opts: { password?: string; email?: string } = {}) {
  const role = await db.query.roles.findFirst({ where: eq(schema.roles.key, roleKey) });
  if (!role) throw new Error(`role ${roleKey} missing`);
  const [u] = await db
    .insert(schema.users)
    .values({ email: opts.email ?? `${roleKey.toLowerCase()}-${uid()}@test.local`, name: `Test ${roleKey}`, passwordHash: await hashPassword(opts.password ?? "correct-horse-battery"), roleId: role.id })
    .returning();
  return { ...u, permissions: role.permissions as string[] };
}

export async function makeCustomer() {
  const user = await makeUser("CUSTOMER");
  const [c] = await db.insert(schema.customers).values({ userId: user.id, name: "Test Customer", email: user.email, phone: `2547${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}` }).returning();
  return { user, customer: c };
}

/** A published product with one priced variant and opening stock at the given cost. */
export async function makeProduct(opts: { priceKes: number; stock: number; costKes?: number | null; trackBatches?: boolean; needsReview?: boolean } = { priceKes: 500, stock: 10 }) {
  const s = uid();
  const [p] = await db
    .insert(schema.products)
    .values({ name: `Test product ${s}`, slug: `test-${s}`, status: "PUBLISHED", needsReview: opts.needsReview ?? false, productType: "COSMETIC", description: "Test" })
    .returning();
  const [v] = await db
    .insert(schema.productVariants)
    .values({ productId: p.id, name: "Default", sku: `T-${s}`, priceCents: opts.priceKes * 100, reorderLevel: 2, reorderQty: 10, trackBatches: opts.trackBatches ?? false })
    .returning();
  const loc = await getDefaultLocationId();
  if (opts.stock > 0) {
    await db.transaction((tx) =>
      receiveIntoStock(tx, { variantId: v.id, locationId: loc, qty: opts.stock, unitCostCents: opts.costKes === null ? null : (opts.costKes ?? Math.round(opts.priceKes / 2)) * 100, type: "INITIAL", reason: "Test opening stock", refType: "MANUAL", refId: "test", userId: null }),
    );
  }
  return { product: p, variant: v, locationId: loc };
}

export async function balance(variantId: string) {
  const loc = await getDefaultLocationId();
  const b = await db.query.inventoryBalances.findFirst({ where: (t, { and, eq }) => and(eq(t.variantId, variantId), eq(t.locationId, loc)) });
  return { onHand: b?.onHand ?? 0, reserved: b?.reserved ?? 0, quarantined: b?.quarantined ?? 0, available: (b?.onHand ?? 0) - (b?.reserved ?? 0) };
}

export async function movements(variantId: string) {
  return db.query.stockMovements.findMany({ where: eq(schema.stockMovements.variantId, variantId), orderBy: (m, { asc }) => asc(m.createdAt) });
}

/** The exact callback body Safaricom sends for an STK result. */
export function stkCallback(checkoutRequestId: string, resultCode: number, extra: { amountKes?: number; receipt?: string; phone?: string } = {}) {
  return {
    Body: {
      stkCallback: {
        MerchantRequestID: "TEST",
        CheckoutRequestID: checkoutRequestId,
        ResultCode: resultCode,
        ResultDesc: resultCode === 0 ? "The service request is processed successfully." : resultCode === 1032 ? "Request cancelled by user" : "The balance is insufficient for the transaction",
        ...(resultCode === 0
          ? {
              CallbackMetadata: {
                Item: [
                  { Name: "Amount", Value: extra.amountKes ?? 0 },
                  { Name: "MpesaReceiptNumber", Value: extra.receipt ?? `TST${uid().toUpperCase()}` },
                  { Name: "TransactionDate", Value: 20260101120000 },
                  { Name: "PhoneNumber", Value: Number(extra.phone ?? "254712345678") },
                ],
              },
            }
          : {}),
      },
    },
  };
}

export const guestCheckout = (variantId: string, qty: number, expectedTotalCents: number, locationId: string, extra: Partial<import("@/lib/orders").CheckoutInput> = {}) => ({
  idempotencyKey: randomUUID(),
  userCustomerId: null,
  contact: { name: "Wanjiku Test", phone: "254712345678", email: "wanjiku@test.local" },
  fulfilment: "COLLECTION" as const,
  deliveryZoneId: null,
  address: null,
  notes: null,
  paymentMethod: "MPESA" as const,
  couponCode: null,
  lines: [{ variantId, qty }],
  expectedTotalCents,
  locationId,
  ...extra,
});
