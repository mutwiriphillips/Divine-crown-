"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { action, moneyField, optStr, str, UserError } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { clientIp, requirePermission } from "@/lib/auth/server";
import { issueDocument } from "@/lib/documents";
import { addOrderEvent, recordPayment, STATUS_LABEL, transitionOrder, type OrderStatus } from "@/lib/orders";
import { issueRefund, markRefundPaidOut } from "@/lib/refunds";

const STATUSES = schema.orderStatus.enumValues as readonly string[];

export const changeStatusAction = action(async (fd) => {
  const to = str(fd, "to") as OrderStatus;
  const user = await requirePermission(to === "CANCELLED" ? "orders.cancel" : "orders.manage");
  if (!STATUSES.includes(to)) throw new UserError("Unknown status.");
  const cond = optStr(fd, "returnCondition") as "RESELLABLE" | "DAMAGED" | "NOT_RETURNED" | null;
  await transitionOrder(str(fd, "orderId"), to, { userId: user.id, ip: await clientIp() }, { note: optStr(fd, "note") ?? undefined, returnCondition: cond ?? undefined });
  revalidatePath(`/admin/orders/${str(fd, "orderId")}`);
  return { ok: true, message: `Order moved to ${STATUS_LABEL[to].toLowerCase()}.` };
});

export const bulkStatusAction = action(async (fd) => {
  const user = await requirePermission("orders.manage");
  const ids = fd.getAll("ids").map(String);
  const to = str(fd, "to") as OrderStatus;
  if (!ids.length) throw new UserError("Select orders first.");
  if (!["PROCESSING", "READY_FOR_COLLECTION", "DISPATCHED"].includes(to)) throw new UserError("That change can only be made one order at a time.");
  const failed: string[] = [];
  for (const id of ids) {
    try {
      await transitionOrder(id, to, { userId: user.id, ip: await clientIp() });
    } catch (e) {
      const o = await db.query.orders.findFirst({ where: eq(schema.orders.id, id), columns: { number: true } });
      failed.push(`${o?.number}: ${(e as Error).message}`);
    }
  }
  revalidatePath("/admin/orders");
  return failed.length
    ? { ok: false, message: `Updated ${ids.length - failed.length}. Not changed — ${failed.join(" · ")}` }
    : { ok: true, message: `Updated ${ids.length} order(s).` };
});

export const assignOrderAction = action(async (fd) => {
  const user = await requirePermission("orders.manage");
  const orderId = str(fd, "orderId");
  const staffId = optStr(fd, "assignedToId");
  await db.transaction(async (tx) => {
    await tx.update(schema.orders).set({ assignedToId: staffId }).where(eq(schema.orders.id, orderId));
    const s = staffId ? await tx.query.users.findFirst({ where: eq(schema.users.id, staffId), columns: { name: true } }) : null;
    await addOrderEvent(tx, { orderId, type: "note", userId: user.id, message: s ? `Assigned to ${s.name}.` : "Unassigned." });
  });
  revalidatePath(`/admin/orders/${orderId}`);
  return { ok: true, message: "Assignment saved." };
});

export const addNoteAction = action(async (fd) => {
  const user = await requirePermission("orders.manage");
  const orderId = str(fd, "orderId");
  const note = str(fd, "note");
  if (note.length < 2) throw new UserError("Write a note.");
  await db.transaction((tx) => addOrderEvent(tx, { orderId, type: "note", userId: user.id, message: note.slice(0, 1000) }));
  revalidatePath(`/admin/orders/${orderId}`);
  return { ok: true, message: "Note added (staff only)." };
});

export const deliveryAction = action(async (fd) => {
  const user = await requirePermission("delivery.manage");
  const orderId = str(fd, "orderId");
  const d = await db.query.deliveries.findFirst({ where: eq(schema.deliveries.orderId, orderId) });
  if (!d) throw new UserError("This order isn't for delivery.");
  const op = str(fd, "op");
  const patch: Partial<typeof schema.deliveries.$inferInsert> = {};
  if (op === "assign") {
    Object.assign(patch, {
      riderName: optStr(fd, "riderName"),
      riderPhone: optStr(fd, "riderPhone"),
      courierName: optStr(fd, "courierName"),
      trackingRef: optStr(fd, "trackingRef"),
      status: d.status === "PENDING" ? "ASSIGNED" : d.status,
      assignedAt: d.assignedAt ?? new Date(),
    });
  } else if (op === "failed") {
    const reason = str(fd, "failedReason");
    if (reason.length < 3) throw new UserError("Say why the delivery failed.");
    Object.assign(patch, { status: "FAILED", failedReason: reason });
  } else if (op === "delivered") {
    Object.assign(patch, { receivedBy: optStr(fd, "receivedBy") });
  } else throw new UserError("Unknown delivery action.");
  await db.transaction(async (tx) => {
    await tx.update(schema.deliveries).set(patch).where(eq(schema.deliveries.id, d.id));
    await addOrderEvent(tx, {
      orderId,
      type: "delivery",
      userId: user.id,
      message: op === "assign" ? `Delivery details updated${patch.courierName ? ` (courier ${patch.courierName})` : patch.riderName ? ` (rider ${patch.riderName})` : ""}.` : op === "failed" ? `Delivery failed: ${patch.failedReason}` : `Received by ${patch.receivedBy ?? "customer"}.`,
    });
  });
  if (op === "delivered") await transitionOrder(orderId, "DELIVERED", { userId: user.id, ip: await clientIp() }).catch(() => undefined);
  if (op === "failed") await transitionOrder(orderId, "PROCESSING", { userId: user.id, ip: await clientIp() }, { note: "Delivery failed" }).catch(() => undefined);
  revalidatePath(`/admin/orders/${orderId}`);
  return { ok: true, message: "Delivery updated." };
});

const MANUAL_METHODS = ["CASH", "MPESA", "BANK_TRANSFER", "CARD", "OTHER"] as const;

export const recordManualPaymentAction = action(async (fd) => {
  const user = await requirePermission("payments.record");
  const orderId = str(fd, "orderId");
  const method = str(fd, "method") as (typeof MANUAL_METHODS)[number];
  if (!MANUAL_METHODS.includes(method)) throw new UserError("Choose how it was paid.");
  const amount = moneyField(fd, "amount", "amount", { required: true })!;
  if (amount <= 0) throw new UserError("Enter the amount received.");
  const reference = optStr(fd, "reference");
  if (method !== "CASH" && !reference) throw new UserError("Enter the transaction reference (e.g. the M-Pesa code) so the payment can be matched to statements.");
  if (method === "MPESA" && !/^[A-Z0-9]{8,12}$/i.test(reference!)) throw new UserError("That doesn't look like an M-Pesa code (e.g. SJK3ABC1XY).");
  await db.transaction(async (tx) => {
    const o = await tx.query.orders.findFirst({ where: eq(schema.orders.id, orderId) });
    if (!o) throw new UserError("Order not found.");
    if (o.status === "CANCELLED" || o.status === "REFUNDED") throw new UserError("This order is closed.");
    if (amount > o.totalCents - o.amountPaidCents) throw new UserError("That's more than the balance due. Record only what was received for this order.");
    await recordPayment(tx, { orderId, method, amountCents: amount, reference, userId: user.id, note: optStr(fd, "note") });
  });
  await audit({ userId: user.id, action: "payment.manual", entityType: "order", entityId: orderId, details: { method, amount, reference }, ip: await clientIp() });
  revalidatePath(`/admin/orders/${orderId}`);
  return { ok: true, message: "Payment recorded." };
});

export const refundAction = action(async (fd) => {
  const user = await requirePermission("refunds.issue");
  const orderId = str(fd, "orderId");
  const order = await db.query.orders.findFirst({ where: eq(schema.orders.id, orderId), with: { items: true } });
  if (!order) throw new UserError("Order not found.");
  const items = order.items.map((i) => ({
    orderItemId: i.id,
    qty: Number(str(fd, `qty_${i.id}`) || 0),
    condition: (str(fd, `cond_${i.id}`) || "RESELLABLE") as "RESELLABLE" | "DAMAGED" | "NOT_RETURNED",
  }));
  if (items.some((i) => !Number.isInteger(i.qty) || i.qty < 0)) throw new UserError("Quantities must be whole numbers.");
  const method = str(fd, "method") as "CASH" | "MPESA" | "BANK_TRANSFER" | "CARD" | "OTHER";
  if (!["CASH", "MPESA", "BANK_TRANSFER", "CARD", "OTHER"].includes(method)) throw new UserError("Choose how the money is returned.");
  const posSessionId = optStr(fd, "posSessionId");
  const refund = await issueRefund({
    orderId,
    idempotencyKey: str(fd, "idempotencyKey"),
    items,
    extraCents: moneyField(fd, "extra", "extra amount") ?? 0,
    method,
    reference: optStr(fd, "reference"),
    reason: str(fd, "reason"),
    payoutPending: method === "MPESA" && !optStr(fd, "reference"),
    userId: user.id,
    posSessionId: method === "CASH" ? posSessionId : null,
    ip: await clientIp(),
  });
  revalidatePath(`/admin/orders/${orderId}`);
  return { ok: true, message: `Refund ${refund.number} recorded.` };
});

export const refundPaidOutAction = action(async (fd) => {
  const user = await requirePermission("refunds.issue");
  await markRefundPaidOut(str(fd, "refundId"), str(fd, "reference"), user.id);
  revalidatePath(`/admin/orders/${str(fd, "orderId")}`);
  return { ok: true, message: "Marked as paid out." };
});

export const issueInvoiceAction = action(async (fd) => {
  await requirePermission("orders.manage");
  const orderId = str(fd, "orderId");
  await db.transaction((tx) => issueDocument(tx, { type: "INVOICE", orderId }));
  revalidatePath(`/admin/orders/${orderId}`);
  return { ok: true, message: "Invoice issued." };
});

