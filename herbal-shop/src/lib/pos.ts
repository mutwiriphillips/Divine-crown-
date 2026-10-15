import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { commitSale, InsufficientStockError, reserveStock } from "@/lib/inventory";
import { formatKES } from "@/lib/money";
import { addOrderEvent, OrderError, recordPayment } from "@/lib/orders";
import { priceCart } from "@/lib/pricing";
import { nextNumber } from "@/lib/sequence";
import { getSetting } from "@/lib/settings";

export async function openShift(args: { cashierId: string; locationId: string; openingFloatCents: number }) {
  if (!Number.isInteger(args.openingFloatCents) || args.openingFloatCents < 0) throw new OrderError("Enter the cash in the drawer (0 or more).");
  return db.transaction(async (tx) => {
    const open = await tx.query.posSessions.findFirst({ where: and(eq(schema.posSessions.cashierId, args.cashierId), eq(schema.posSessions.status, "OPEN")) });
    if (open) return open;
    const [s] = await tx.insert(schema.posSessions).values({ ...args }).returning();
    await tx.insert(schema.cashMovements).values({ sessionId: s.id, type: "OPENING_FLOAT", amountCents: args.openingFloatCents, reason: "Opening float", userId: args.cashierId });
    await audit({ userId: args.cashierId, action: "pos.shift_open", entityType: "pos_session", entityId: s.id, details: { openingFloatCents: args.openingFloatCents } }, tx);
    return s;
  });
}

export async function expectedCash(sessionId: string) {
  const r = await db.execute<{ total: number }>(sql`select coalesce(sum(amount_cents),0)::int as total from cash_movements where session_id = ${sessionId}`);
  return Number(r.rows[0].total);
}

export async function closeShift(args: { sessionId: string; countedCents: number; note: string | null; userId: string; canCloseOthers: boolean }) {
  return db.transaction(async (tx) => {
    const rows = await tx.select().from(schema.posSessions).where(eq(schema.posSessions.id, args.sessionId)).for("update");
    const s = rows[0];
    if (!s) throw new OrderError("Shift not found.");
    if (s.status !== "OPEN") throw new OrderError("This shift is already closed.");
    if (s.cashierId !== args.userId && !args.canCloseOthers) throw new OrderError("Only the cashier or a manager can close this shift.");
    const r = await tx.execute<{ total: number }>(sql`select coalesce(sum(amount_cents),0)::int as total from cash_movements where session_id = ${s.id}`);
    const expected = Number(r.rows[0].total);
    const variance = args.countedCents - expected;
    if (variance !== 0 && !(args.note && args.note.trim().length >= 3)) {
      throw new OrderError(`The count is ${formatKES(Math.abs(variance))} ${variance > 0 ? "over" : "short"}. Add a note explaining the difference to close the shift.`);
    }
    const pendingSuspended = await tx.query.suspendedSales.findFirst({ where: and(eq(schema.suspendedSales.sessionId, s.id), sql`${schema.suspendedSales.resumedAt} is null`) });
    await tx
      .update(schema.posSessions)
      .set({ status: "CLOSED", expectedCashCents: expected, countedCashCents: args.countedCents, varianceCents: variance, closingNote: args.note, closedAt: new Date(), closedById: args.userId })
      .where(eq(schema.posSessions.id, s.id));
    if (pendingSuspended) {
      await tx.update(schema.suspendedSales).set({ resumedAt: new Date() }).where(and(eq(schema.suspendedSales.sessionId, s.id), sql`${schema.suspendedSales.resumedAt} is null`));
    }
    await audit({ userId: args.userId, action: "pos.shift_close", entityType: "pos_session", entityId: s.id, details: { expected, counted: args.countedCents, variance } }, tx);
    return { expected, variance };
  });
}

export async function cashMovement(args: { sessionId: string; type: "PAY_IN" | "PAY_OUT" | "CASH_DROP"; amountCents: number; reason: string; userId: string }) {
  if (!Number.isInteger(args.amountCents) || args.amountCents <= 0) throw new OrderError("Enter an amount greater than zero.");
  if (args.reason.trim().length < 3) throw new OrderError("Give a reason.");
  return db.transaction(async (tx) => {
    const s = await tx.query.posSessions.findFirst({ where: eq(schema.posSessions.id, args.sessionId) });
    if (!s || s.status !== "OPEN") throw new OrderError("The shift isn't open.");
    const signed = args.type === "PAY_IN" ? args.amountCents : -args.amountCents;
    await tx.insert(schema.cashMovements).values({ sessionId: s.id, type: args.type, amountCents: signed, reason: args.reason.trim(), userId: args.userId });
    await audit({ userId: args.userId, action: `pos.${args.type.toLowerCase()}`, entityType: "pos_session", entityId: s.id, details: { amountCents: args.amountCents, reason: args.reason } }, tx);
  });
}

export type PosPaymentInput = { method: "CASH" | "MPESA" | "CARD" | "BANK_TRANSFER" | "OTHER"; amountCents: number; reference?: string | null };

export type PosSaleInput = {
  idempotencyKey: string;
  sessionId: string;
  cashier: { id: string; permissions: string[] };
  customerId: string | null;
  lines: { variantId: string; qty: number; overrideUnitCents?: number | null }[];
  manualDiscountCents: number;
  payments: PosPaymentInput[];
  /** Instead of taking payment now, send an M-Pesa prompt; the sale completes when it's confirmed. */
  stkPhone?: string | null;
  ip?: string | null;
};

/**
 * Complete a walk-in sale in one transaction: order + items + stock deduction + payments + receipt + cash movement + audit.
 * A repeated submit with the same idempotency key returns the original sale instead of selling twice.
 */
export async function completePosSale(input: PosSaleInput) {
  const commerce = await getSetting("commerce");
  return db.transaction(async (tx) => {
    const dupe = await tx.query.orders.findFirst({ where: eq(schema.orders.idempotencyKey, input.idempotencyKey) });
    if (dupe) return { order: dupe, receiptId: (await tx.query.documents.findFirst({ where: and(eq(schema.documents.orderId, dupe.id), eq(schema.documents.type, "RECEIPT")) }))?.id ?? null, changeCents: 0, duplicate: true };

    const session = await tx.query.posSessions.findFirst({ where: eq(schema.posSessions.id, input.sessionId) });
    if (!session || session.status !== "OPEN") throw new OrderError("Open a shift before selling.");
    if (session.cashierId !== input.cashier.id) throw new OrderError("This shift belongs to another cashier.");

    const perms = input.cashier.permissions;
    if (input.lines.some((l) => l.overrideUnitCents != null) && !perms.includes("pos.price_override")) throw new OrderError("You don't have permission to change prices.");
    if (input.manualDiscountCents > 0 && !perms.includes("pos.discount")) throw new OrderError("You don't have permission to give discounts.");

    let isWholesale = false;
    let customer: typeof schema.customers.$inferSelect | undefined;
    if (input.customerId) {
      customer = await tx.query.customers.findFirst({ where: eq(schema.customers.id, input.customerId) });
      isWholesale = !!customer?.isWholesale;
    }
    const priced = await priceCart(tx, input.lines, {
      channel: "POS",
      customerId: input.customerId,
      isWholesaleCustomer: isWholesale,
      fulfilment: "WALK_IN",
      manualDiscountCents: input.manualDiscountCents,
      locationId: session.locationId,
      settings: commerce,
    });
    if (priced.issues.length) throw new OrderError(priced.issues.map((i) => i.message).join(" "), priced.issues);
    if (priced.lines.length === 0) throw new OrderError("Add at least one item.");
    const total = priced.totalCents;

    const useStk = !!input.stkPhone;
    const pays = useStk ? [] : input.payments.filter((p) => p.amountCents > 0);
    const nonCash = pays.filter((p) => p.method !== "CASH").reduce((a, p) => a + p.amountCents, 0);
    const cashTendered = pays.filter((p) => p.method === "CASH").reduce((a, p) => a + p.amountCents, 0);
    if (!useStk) {
      if (nonCash > total) throw new OrderError("Card/M-Pesa amounts are more than the total. Only cash can be over the total.");
      if (nonCash + cashTendered < total) throw new OrderError(`Payment is ${formatKES(total - nonCash - cashTendered)} short.`);
      for (const p of pays) {
        if (p.method === "MPESA") {
          if (!commerce.posAllowManualMpesaCode) throw new OrderError("Use the M-Pesa prompt for M-Pesa payments.");
          if (!p.reference || !/^[A-Z0-9]{8,12}$/i.test(p.reference.trim())) throw new OrderError("Enter the M-Pesa confirmation code from the message (e.g. SJK3ABC1XY).");
        }
      }
    }
    const cashApplied = Math.min(cashTendered, total - nonCash);
    const change = cashTendered - cashApplied;

    const number = await nextNumber(tx, "ORDER");
    const [order] = await tx
      .insert(schema.orders)
      .values({
        number,
        idempotencyKey: input.idempotencyKey,
        source: "POS",
        status: "AWAITING_PAYMENT",
        paymentStatus: useStk ? "PENDING" : "UNPAID",
        fulfilmentMethod: "WALK_IN",
        customerId: input.customerId,
        contactName: customer?.name ?? "Walk-in customer",
        contactPhone: customer?.phone ?? input.stkPhone ?? null,
        contactEmail: customer?.email ?? null,
        isWholesale,
        taxInclusive: priced.taxInclusive,
        subtotalCents: priced.subtotalCents,
        discountCents: priced.orderDiscountCents,
        taxCents: priced.taxCents,
        totalCents: total,
        locationId: session.locationId,
        stockState: "NONE",
        posSessionId: session.id,
        cashierId: input.cashier.id,
        reservationExpiresAt: useStk ? new Date(Date.now() + 10 * 60_000) : null,
        isDemo: priced.lines.some((l) => l.isDemo),
      })
      .returning();
    await tx.insert(schema.orderItems).values(
      priced.lines.map((l) => ({
        orderId: order.id,
        variantId: l.variantId,
        productName: l.productName,
        variantName: l.variantName,
        sku: l.sku,
        qty: l.qty,
        unitPriceCents: l.unitPriceCents,
        listPriceCents: l.listPriceCents,
        discountCents: l.lineDiscountCents,
        lineTotalCents: l.lineTotalCents,
        taxCents: l.taxCents,
        unitCostCents: l.unitCostCents,
        priceOverriddenById: l.overridden ? input.cashier.id : null,
      })),
    );
    for (const l of priced.lines.filter((x) => x.overridden)) {
      await audit({ userId: input.cashier.id, action: "price.override", entityType: "order", entityId: order.id, details: { product: l.productName, listPriceCents: l.listPriceCents, chargedCents: l.unitPriceCents }, ip: input.ip }, tx);
    }
    if (input.manualDiscountCents > 0) {
      await audit({ userId: input.cashier.id, action: "pos.discount", entityType: "order", entityId: order.id, details: { discountCents: input.manualDiscountCents }, ip: input.ip }, tx);
    }
    for (const p of priced.appliedPromotions) {
      await tx.execute(sql`update promotions set usage_count = usage_count + 1 where id = ${p.id}`);
      await tx.insert(schema.promotionRedemptions).values({ promotionId: p.id, orderId: order.id, customerId: input.customerId, amountCents: p.amountCents });
    }

    const stockLines = priced.lines.map((l) => ({ variantId: l.variantId, qty: l.qty }));
    try {
      if (useStk) {
        await reserveStock(tx, session.locationId, stockLines, { orderId: order.id, userId: input.cashier.id });
        await tx.update(schema.orders).set({ stockState: "RESERVED" }).where(eq(schema.orders.id, order.id));
      } else {
        await commitSale(tx, session.locationId, stockLines, { orderId: order.id, userId: input.cashier.id, fromReservation: false });
        await tx.update(schema.orders).set({ stockState: "COMMITTED" }).where(eq(schema.orders.id, order.id));
      }
    } catch (e) {
      if (e instanceof InsufficientStockError) throw new OrderError("Stock count says one of these items isn't available. Check the shelf and adjust stock if needed.");
      throw e;
    }
    await addOrderEvent(tx, { orderId: order.id, type: "status_change", userId: input.cashier.id, message: "Point-of-sale sale started." });

    let receiptId: string | null = null;
    if (!useStk) {
      const toRecord = [
        ...pays.filter((p) => p.method !== "CASH").map((p) => ({ ...p, amountCents: p.amountCents })),
        ...(cashApplied > 0 ? [{ method: "CASH" as const, amountCents: cashApplied, reference: null }] : []),
      ];
      for (let i = 0; i < toRecord.length; i++) {
        const p = toRecord[i];
        const last = i === toRecord.length - 1;
        const r = await recordPayment(tx, {
          orderId: order.id,
          method: p.method,
          amountCents: p.amountCents,
          reference: p.reference ?? null,
          userId: input.cashier.id,
          posSessionId: session.id,
          issueReceipt: last,
          cashTenderedCents: last && cashTendered > 0 ? cashTendered : undefined,
          changeCents: last && cashTendered > 0 ? change : undefined,
        });
        if (r.receipt) receiptId = r.receipt.id;
      }
      if (cashApplied > 0) {
        await tx.insert(schema.cashMovements).values({ sessionId: session.id, type: "SALE", amountCents: cashApplied, reason: `Sale ${number}`, refType: "ORDER", refId: order.id, userId: input.cashier.id });
      }
    }
    const final = await tx.query.orders.findFirst({ where: eq(schema.orders.id, order.id) });
    return { order: final!, receiptId, changeCents: change, duplicate: false };
  });
}

export async function suspendSale(args: { sessionId: string; label: string; payload: unknown; userId: string }) {
  const s = await db.query.posSessions.findFirst({ where: eq(schema.posSessions.id, args.sessionId) });
  if (!s || s.status !== "OPEN") throw new OrderError("The shift isn't open.");
  const [row] = await db.insert(schema.suspendedSales).values({ sessionId: s.id, label: args.label.slice(0, 60) || "Held sale", payload: args.payload as object }).returning();
  return row;
}
