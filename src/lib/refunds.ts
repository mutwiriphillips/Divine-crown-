import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { issueDocument } from "@/lib/documents";
import { applyMovement, expandBundles } from "@/lib/inventory";
import { formatKES } from "@/lib/money";
import { notify } from "@/lib/notifications";
import { addOrderEvent, lockOrder, OrderError, type PaymentMethod } from "@/lib/orders";
import { nextNumber } from "@/lib/sequence";

export type RefundInput = {
  orderId: string;
  idempotencyKey: string;
  items: { orderItemId: string; qty: number; condition: "RESELLABLE" | "DAMAGED" | "NOT_RETURNED" }[];
  /** Extra amount not tied to items (e.g. delivery fee, goodwill). */
  extraCents: number;
  method: PaymentMethod;
  reference: string | null;
  reason: string;
  /** For M-Pesa refunds: money still has to be sent from the M-Pesa org portal. */
  payoutPending: boolean;
  userId: string;
  posSessionId?: string | null;
  ip?: string | null;
};

/**
 * Issue a refund. The refund is a new record (the original sale and payments are never edited):
 * - order.refundedCents increases; status becomes PARTIALLY_REFUNDED or REFUNDED
 * - resellable returns go back into sellable stock; damaged ones go to quarantine; not-returned items don't move stock
 * - a credit note is issued
 * - cash refunds from a POS drawer create a cash movement
 * Automatic M-Pesa reversals are not assumed: M-Pesa refunds are recorded and marked "payout pending"
 * until staff confirm the money was sent.
 */
export async function issueRefund(input: RefundInput) {
  const reason = input.reason.trim();
  if (reason.length < 3) throw new OrderError("Give a reason for the refund.");
  return db.transaction(async (tx) => {
    const dupe = await tx.query.refunds.findFirst({ where: eq(schema.refunds.idempotencyKey, input.idempotencyKey) });
    if (dupe) return dupe;
    const order = await lockOrder(tx, input.orderId);
    const items = await tx.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, order.id));
    const wanted = input.items.filter((i) => i.qty > 0);

    let itemsTotal = 0;
    const lines: { item: (typeof items)[number]; qty: number; amount: number; condition: RefundInput["items"][number]["condition"] }[] = [];
    for (const w of wanted) {
      const item = items.find((i) => i.id === w.orderItemId);
      if (!item) throw new OrderError("A refund line doesn't belong to this order.");
      if (!Number.isInteger(w.qty) || w.qty + item.qtyRefunded > item.qty) {
        throw new OrderError(`You can refund at most ${item.qty - item.qtyRefunded} of ${item.productName}.`);
      }
      // Refund what was actually paid per unit (line total includes line discounts). Order-level discounts
      // are shared out proportionally so refunds never exceed what the customer paid for the line.
      const orderLevelShare = order.subtotalCents > 0 ? Math.floor((item.lineTotalCents * order.discountCents) / order.subtotalCents) : 0;
      const paidForLine = item.lineTotalCents - orderLevelShare;
      const amount = Math.floor((paidForLine * w.qty) / item.qty);
      itemsTotal += amount;
      lines.push({ item, qty: w.qty, amount, condition: w.condition });
    }
    const extra = Math.max(0, Math.floor(input.extraCents));
    const amount = itemsTotal + extra;
    if (amount <= 0) throw new OrderError("Choose items to refund or enter an amount.");
    const refundable = order.amountPaidCents - order.refundedCents;
    if (amount > refundable) throw new OrderError(`Only ${formatKES(refundable)} can be refunded on this order.`);

    const number = await nextNumber(tx, "CREDIT_NOTE");
    const [refund] = await tx
      .insert(schema.refunds)
      .values({
        number,
        idempotencyKey: input.idempotencyKey,
        orderId: order.id,
        amountCents: amount,
        reason,
        method: input.method,
        reference: input.reference,
        status: input.payoutPending ? "PENDING_PAYOUT" : "COMPLETED",
        createdById: input.userId,
        posSessionId: input.posSessionId ?? null,
        paidOutAt: input.payoutPending ? null : new Date(),
      })
      .returning();

    if (lines.length) {
      await tx.insert(schema.refundItems).values(
        lines.map((l) => ({ refundId: refund.id, orderItemId: l.item.id, qty: l.qty, amountCents: l.amount, condition: l.condition })),
      );
    }
    for (const l of lines) {
      await tx
        .update(schema.orderItems)
        .set({ qtyRefunded: l.item.qtyRefunded + l.qty })
        .where(eq(schema.orderItems.id, l.item.id));
      // Only goods that actually left stock can come back.
      if (order.stockState !== "COMMITTED" || l.condition === "NOT_RETURNED") continue;
      for (const c of await expandBundles(tx, [{ variantId: l.item.variantId, qty: l.qty }])) {
        if (l.condition === "RESELLABLE") {
          await applyMovement(tx, { variantId: c.variantId, locationId: order.locationId, type: "CUSTOMER_RETURN", onHandDelta: c.qty, reason: `Returned: ${reason}`, refType: "REFUND", refId: refund.id, userId: input.userId });
        } else {
          await applyMovement(tx, { variantId: c.variantId, locationId: order.locationId, type: "QUARANTINE_IN", quarantineDelta: c.qty, reason: `Returned damaged: ${reason}`, refType: "REFUND", refId: refund.id, userId: input.userId });
        }
      }
    }

    // If an order was refunded before its stock was committed (e.g. reserved, unpaid remainder), release it.
    const refunded = order.refundedCents + amount;
    const fullyRefunded = refunded >= order.amountPaidCents;
    let stockState = order.stockState;
    if (fullyRefunded && order.stockState === "RESERVED") {
      const all = items.map((i) => ({ variantId: i.variantId, qty: i.qty }));
      for (const c of await expandBundles(tx, all)) {
        await applyMovement(tx, { variantId: c.variantId, locationId: order.locationId, type: "RESERVATION_RELEASE", reservedDelta: -c.qty, reason: "Order refunded", refType: "REFUND", refId: refund.id, userId: input.userId });
      }
      stockState = "RELEASED";
    }
    const status = fullyRefunded ? "REFUNDED" : "PARTIALLY_REFUNDED";
    await tx
      .update(schema.orders)
      .set({ refundedCents: refunded, status, paymentStatus: fullyRefunded ? "REFUNDED" : "PARTIALLY_REFUNDED", stockState })
      .where(eq(schema.orders.id, order.id));

    if (input.method === "CASH" && input.posSessionId) {
      const session = await tx.query.posSessions.findFirst({ where: eq(schema.posSessions.id, input.posSessionId) });
      if (!session || session.status !== "OPEN") throw new OrderError("Open a till shift to give a cash refund from the drawer.");
      await tx.insert(schema.cashMovements).values({ sessionId: input.posSessionId, type: "REFUND", amountCents: -amount, reason: `Refund ${number}`, refType: "REFUND", refId: refund.id, userId: input.userId });
    }

    await issueDocument(tx, { type: "CREDIT_NOTE", orderId: order.id, refundId: refund.id });
    await addOrderEvent(tx, {
      orderId: order.id,
      type: "refund",
      userId: input.userId,
      fromStatus: order.status,
      toStatus: status,
      message: `Refund ${number}: ${formatKES(amount)} by ${input.method}${input.payoutPending ? " (payout pending)" : ""}. ${reason}`,
    });
    await audit(
      {
        userId: input.userId,
        action: "refund.create",
        entityType: "order",
        entityId: order.id,
        details: { refundId: refund.id, amountCents: amount, method: input.method, items: lines.map((l) => ({ item: l.item.productName, qty: l.qty, condition: l.condition })) },
        ip: input.ip,
      },
      tx,
    );
    await notify(tx, {
      event: "refund.issued",
      entityType: "refund",
      entityId: refund.id,
      to: { customerId: order.customerId, name: order.contactName, email: order.contactEmail, phone: order.contactPhone },
      vars: {
        orderNumber: order.number,
        amount: formatKES(amount),
        refundNumber: number,
        payoutLine: input.payoutPending ? "We'll send the money to your M-Pesa shortly." : "",
      },
    });
    return refund;
  });
}

export async function markRefundPaidOut(refundId: string, reference: string, userId: string) {
  return db.transaction(async (tx) => {
    const r = await tx.query.refunds.findFirst({ where: eq(schema.refunds.id, refundId) });
    if (!r) throw new OrderError("Refund not found.");
    if (r.status !== "PENDING_PAYOUT") throw new OrderError("This refund is already paid out.");
    if (!reference.trim()) throw new OrderError("Enter the transaction reference for the payout.");
    await tx.update(schema.refunds).set({ status: "COMPLETED", paidOutAt: new Date(), reference: reference.trim().toUpperCase() }).where(eq(schema.refunds.id, refundId));
    await addOrderEvent(tx, { orderId: r.orderId, type: "refund", userId, message: `Refund ${r.number} paid out (ref ${reference.trim().toUpperCase()}).` });
    await audit({ userId, action: "refund.payout", entityType: "refund", entityId: refundId, details: { reference } }, tx);
  });
}

export async function refundsForOrders(orderIds: string[]) {
  if (!orderIds.length) return [];
  return db.select().from(schema.refunds).where(inArray(schema.refunds.orderId, orderIds));
}
