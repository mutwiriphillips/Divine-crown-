"use server";

import { and, eq, ilike, isNull, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, schema } from "@/db";
import { action, moneyField, str, toActionError, UserError, type ActionState } from "@/lib/actions";
import { normalizePhone } from "@/lib/auth/core";
import { clientIp, requirePermission } from "@/lib/auth/server";
import { getDefaultLocationId } from "@/lib/inventory";
import { initiateStkPush } from "@/lib/payments/mpesa";
import { cashMovement, closeShift, completePosSale, openShift, suspendSale } from "@/lib/pos";
import { priceCart } from "@/lib/pricing";
import { getSetting } from "@/lib/settings";

export const openShiftAction = action(async (fd) => {
  const user = await requirePermission("pos.use");
  await openShift({ cashierId: user.id, locationId: str(fd, "locationId") || (await getDefaultLocationId()), openingFloatCents: moneyField(fd, "float", "opening cash", { required: true })! });
  revalidatePath("/admin/pos");
  return { ok: true, message: "Shift opened." };
});

const lineSchema = z.object({ variantId: z.string().uuid(), qty: z.number().int().min(1).max(999), overrideUnitCents: z.number().int().min(0).nullable().optional() });
const saleSchema = z.object({
  sessionId: z.string().uuid(),
  idempotencyKey: z.string().uuid(),
  customerId: z.string().uuid().nullable(),
  lines: z.array(lineSchema).min(1).max(200),
  manualDiscountCents: z.number().int().min(0),
  payments: z.array(z.object({ method: z.enum(["CASH", "MPESA", "CARD", "BANK_TRANSFER", "OTHER"]), amountCents: z.number().int().min(0), reference: z.string().trim().max(40).nullable().optional() })).max(6),
  stkPhone: z.string().nullable().optional(),
});

export type PosQuote = { totalCents: number; subtotalCents: number; discountCents: number; taxCents: number; taxInclusive: boolean; issues: string[]; lines: { variantId: string; unitPriceCents: number; lineTotalCents: number; available: number }[] };

export async function posQuoteAction(input: { lines: z.infer<typeof lineSchema>[]; manualDiscountCents: number; customerId: string | null }): Promise<PosQuote | { error: string }> {
  try {
    const user = await requirePermission("pos.use");
    const lines = z.array(lineSchema).max(200).parse(input.lines);
    if (lines.some((l) => l.overrideUnitCents != null) && !user.permissions.includes("pos.price_override")) return { error: "You can't change prices." };
    if (input.manualDiscountCents > 0 && !user.permissions.includes("pos.discount")) return { error: "You can't give discounts." };
    const customer = input.customerId ? await db.query.customers.findFirst({ where: eq(schema.customers.id, input.customerId) }) : null;
    const session = await db.query.posSessions.findFirst({ where: and(eq(schema.posSessions.cashierId, user.id), eq(schema.posSessions.status, "OPEN")) });
    const p = await priceCart(db, lines, {
      channel: "POS",
      customerId: input.customerId,
      isWholesaleCustomer: !!customer?.isWholesale,
      fulfilment: "WALK_IN",
      manualDiscountCents: Math.max(0, Math.floor(input.manualDiscountCents)),
      locationId: session?.locationId ?? (await getDefaultLocationId()),
      settings: await getSetting("commerce"),
    });
    return {
      totalCents: p.totalCents,
      subtotalCents: p.subtotalCents,
      discountCents: p.discountCents,
      taxCents: p.taxCents,
      taxInclusive: p.taxInclusive,
      issues: p.issues.map((i) => i.message),
      lines: p.lines.map((l) => ({ variantId: l.variantId, unitPriceCents: l.unitPriceCents, lineTotalCents: l.lineTotalCents, available: l.available })),
    };
  } catch (e) {
    return { error: (toActionError(e) as { message: string }).message };
  }
}

export async function completeSaleAction(payload: unknown): Promise<ActionState> {
  try {
    const user = await requirePermission("pos.use");
    const d = saleSchema.parse(payload);
    let stkPhone: string | null = null;
    if (d.stkPhone) {
      stkPhone = normalizePhone(d.stkPhone);
      if (!stkPhone) throw new UserError("Enter the customer's M-Pesa number like 0712 345 678.");
    }
    const r = await completePosSale({ ...d, payments: d.payments.map((p) => ({ ...p, reference: p.reference ?? null })), stkPhone, cashier: { id: user.id, permissions: user.permissions }, ip: await clientIp() });
    let attemptId: string | null = null;
    if (stkPhone && !r.duplicate) {
      try {
        attemptId = (await initiateStkPush(r.order.id, stkPhone)).attemptId;
      } catch (e) {
        return { ok: false, message: `${(e as Error).message} The sale is saved as ${r.order.number} awaiting payment — take another payment method from the order page, or try again.`, data: { orderId: r.order.id, number: r.order.number } };
      }
    }
    revalidatePath("/admin/pos");
    return { ok: true, message: stkPhone ? "Payment request sent to the customer's phone." : "Sale complete.", data: { orderId: r.order.id, number: r.order.number, receiptId: r.receiptId, changeCents: r.changeCents, attemptId, status: r.order.status } };
  } catch (e) {
    return toActionError(e);
  }
}

export async function suspendSaleAction(input: { sessionId: string; label: string; cart: unknown }): Promise<ActionState> {
  try {
    const user = await requirePermission("pos.use");
    await suspendSale({ sessionId: input.sessionId, label: input.label, payload: input.cart, userId: user.id });
    revalidatePath("/admin/pos");
    return { ok: true, message: "Sale put on hold." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function resumeSaleAction(id: string): Promise<{ cart: unknown } | { error: string }> {
  const user = await requirePermission("pos.use");
  const s = await db.query.suspendedSales.findFirst({ where: and(eq(schema.suspendedSales.id, id), isNull(schema.suspendedSales.resumedAt)), with: { session: true } });
  if (!s || s.session.cashierId !== user.id) return { error: "That held sale isn't available." };
  await db.update(schema.suspendedSales).set({ resumedAt: new Date() }).where(eq(schema.suspendedSales.id, id));
  revalidatePath("/admin/pos");
  return { cart: s.payload };
}

export async function customerSearchAction(q: string) {
  const user = await requirePermission("pos.use");
  const term = q.trim();
  if (term.length < 2) return [];
  const digits = term.replace(/\D/g, "");
  const rows = await db
    .select()
    .from(schema.customers)
    .where(and(isNull(schema.customers.anonymizedAt), or(ilike(schema.customers.name, `%${term}%`), digits.length >= 4 ? ilike(schema.customers.phone, `%${digits.slice(-9)}%`) : undefined)))
    .limit(8);
  const seeContact = user.permissions.includes("customers.view_contact");
  return rows.map((c) => ({ id: c.id, name: c.name, phone: seeContact ? c.phone : c.phone ? `••• ${c.phone.slice(-3)}` : null, isWholesale: c.isWholesale }));
}

export async function quickCustomerAction(name: string, phone: string): Promise<{ id: string; name: string; phone: string | null; isWholesale: boolean } | { error: string }> {
  await requirePermission("pos.use");
  const n = name.trim();
  const p = phone.trim() ? normalizePhone(phone) : null;
  if (n.length < 2) return { error: "Enter a name." };
  if (phone.trim() && !p) return { error: "Check the phone number." };
  if (p) {
    const existing = await db.query.customers.findFirst({ where: eq(schema.customers.phone, p) });
    if (existing) return { id: existing.id, name: existing.name, phone: existing.phone, isWholesale: existing.isWholesale };
  }
  const [c] = await db.insert(schema.customers).values({ name: n, phone: p }).returning();
  return { id: c.id, name: c.name, phone: c.phone, isWholesale: c.isWholesale };
}

export const cashMovementAction = action(async (fd) => {
  const user = await requirePermission("pos.use");
  const type = str(fd, "type") as "PAY_IN" | "PAY_OUT" | "CASH_DROP";
  if (!["PAY_IN", "PAY_OUT", "CASH_DROP"].includes(type)) throw new UserError("Choose a type.");
  await cashMovement({ sessionId: str(fd, "sessionId"), type, amountCents: moneyField(fd, "amount", "amount", { required: true })!, reason: str(fd, "reason"), userId: user.id });
  revalidatePath("/admin/pos");
  return { ok: true, message: "Recorded." };
});

export const closeShiftAction = action(async (fd) => {
  const user = await requirePermission("pos.use");
  const r = await closeShift({
    sessionId: str(fd, "sessionId"),
    countedCents: moneyField(fd, "counted", "cash counted", { required: true })!,
    note: str(fd, "note") || null,
    userId: user.id,
    canCloseOthers: user.permissions.includes("pos.manage_shifts"),
  });
  revalidatePath("/admin/pos");
  revalidatePath("/admin/pos/shifts");
  return { ok: true, message: r.variance === 0 ? "Shift closed. Cash balanced." : `Shift closed. Cash was ${r.variance > 0 ? "over" : "short"} by KES ${Math.abs(r.variance / 100).toLocaleString("en-KE")}.` };
});
