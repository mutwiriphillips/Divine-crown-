import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { receiveIntoStock } from "@/lib/inventory";
import { notifyStaff } from "@/lib/notifications";
import { OrderError } from "@/lib/orders";
import { nextNumber } from "@/lib/sequence";

export async function createPurchaseOrder(args: {
  supplierId: string;
  locationId: string;
  expectedAt: Date | null;
  notes: string | null;
  items: { variantId: string; qty: number; unitCostCents: number }[];
  userId: string;
}) {
  const items = args.items.filter((i) => i.qty > 0);
  if (!items.length) throw new OrderError("Add at least one item.");
  for (const i of items) {
    if (!Number.isInteger(i.qty) || i.qty <= 0) throw new OrderError("Quantities must be whole numbers.");
    if (!Number.isInteger(i.unitCostCents) || i.unitCostCents < 0) throw new OrderError("Enter a cost for each item.");
  }
  return db.transaction(async (tx) => {
    const number = await nextNumber(tx, "PO", 5);
    const [po] = await tx
      .insert(schema.purchaseOrders)
      .values({ number, supplierId: args.supplierId, locationId: args.locationId, expectedAt: args.expectedAt, notes: args.notes, createdById: args.userId })
      .returning();
    await tx.insert(schema.purchaseOrderItems).values(items.map((i) => ({ poId: po.id, ...i, qtyOrdered: i.qty })));
    await audit({ userId: args.userId, action: "po.create", entityType: "purchase_order", entityId: po.id, details: { number } }, tx);
    return po;
  });
}

export async function setPurchaseOrderStatus(poId: string, to: "ORDERED" | "CANCELLED", userId: string) {
  return db.transaction(async (tx) => {
    const rows = await tx.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.id, poId)).for("update");
    const po = rows[0];
    if (!po) throw new OrderError("Purchase order not found.");
    if (to === "ORDERED" && po.status !== "DRAFT") throw new OrderError("Only draft orders can be marked as ordered.");
    if (to === "CANCELLED" && !["DRAFT", "ORDERED"].includes(po.status)) throw new OrderError("Orders with received goods can't be cancelled.");
    await tx.update(schema.purchaseOrders).set({ status: to, orderedAt: to === "ORDERED" ? new Date() : po.orderedAt }).where(eq(schema.purchaseOrders.id, poId));
    await audit({ userId, action: `po.${to.toLowerCase()}`, entityType: "purchase_order", entityId: poId }, tx);
    await notifyStaff(tx, { event: "staff.po_update", entityType: "purchase_order", entityId: poId, dedupeKey: `po:${poId}:${to}`, vars: { poNumber: po.number, message: to === "ORDERED" ? "sent to supplier" : "cancelled" } });
  });
}

/**
 * Receive goods. Stock increases exactly once per receipt: the idempotency key (generated when the form
 * is opened) is unique in the database, and PO lines are row-locked so concurrent receipts can't over-receive.
 */
export async function receiveGoods(args: {
  idempotencyKey: string;
  poId: string | null;
  supplierId: string;
  locationId: string;
  supplierInvoiceRef: string | null;
  notes: string | null;
  items: { poItemId: string | null; variantId: string; qty: number; unitCostCents: number; batchNo: string | null; expiresAt: Date | null }[];
  userId: string;
}) {
  const items = args.items.filter((i) => i.qty > 0);
  if (!items.length) throw new OrderError("Enter the quantity received for at least one item.");
  return db.transaction(async (tx) => {
    const dupe = await tx.query.goodsReceipts.findFirst({ where: eq(schema.goodsReceipts.idempotencyKey, args.idempotencyKey) });
    if (dupe) return { receipt: dupe, duplicate: true };

    let po: typeof schema.purchaseOrders.$inferSelect | undefined;
    if (args.poId) {
      po = (await tx.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.id, args.poId)).for("update"))[0];
      if (!po) throw new OrderError("Purchase order not found.");
      if (!["ORDERED", "PARTIALLY_RECEIVED", "DRAFT"].includes(po.status)) throw new OrderError("This purchase order is closed.");
    }
    const number = await nextNumber(tx, "GRN", 5);
    const [receipt] = await tx
      .insert(schema.goodsReceipts)
      .values({
        number,
        idempotencyKey: args.idempotencyKey,
        poId: args.poId,
        supplierId: args.supplierId,
        locationId: args.locationId,
        supplierInvoiceRef: args.supplierInvoiceRef,
        notes: args.notes,
        receivedById: args.userId,
      })
      .returning();

    for (const i of items) {
      if (!Number.isInteger(i.qty) || i.qty <= 0) throw new OrderError("Quantities must be whole numbers.");
      const v = await tx.query.productVariants.findFirst({ where: eq(schema.productVariants.id, i.variantId), with: { product: true } });
      if (!v || v.isBundle) throw new OrderError("Choose a stocked product for each line.");
      if (v.trackBatches && !i.batchNo) throw new OrderError(`${v.product.name} is batch-tracked: enter the batch number.`);
      if (i.poItemId) {
        const res = await tx.execute(sql`
          update purchase_order_items set qty_received = qty_received + ${i.qty}
           where id = ${i.poItemId} and po_id = ${args.poId} and qty_received + ${i.qty} <= qty_ordered
           returning id`);
        if (res.rows.length === 0) throw new OrderError("You're receiving more than is outstanding on the order. Check the quantities.");
      }
      await tx.insert(schema.goodsReceiptItems).values({ receiptId: receipt.id, ...i });
      await receiveIntoStock(tx, {
        variantId: i.variantId,
        locationId: args.locationId,
        qty: i.qty,
        unitCostCents: i.unitCostCents,
        type: "PURCHASE_RECEIVED",
        reason: `Received on ${number}${po ? ` (${po.number})` : ""}`,
        refType: "GOODS_RECEIPT",
        refId: receipt.id,
        userId: args.userId,
        batchNo: i.batchNo,
        expiresAt: i.expiresAt,
      });
    }
    if (po) {
      const r = await tx.execute<{ outstanding: number }>(
        sql`select coalesce(sum(qty_ordered - qty_received),0)::int as outstanding from purchase_order_items where po_id = ${po.id}`,
      );
      const status = Number(r.rows[0].outstanding) === 0 ? "RECEIVED" : "PARTIALLY_RECEIVED";
      await tx.update(schema.purchaseOrders).set({ status, orderedAt: po.orderedAt ?? new Date() }).where(eq(schema.purchaseOrders.id, po.id));
    }
    await audit({ userId: args.userId, action: "stock.receive", entityType: "goods_receipt", entityId: receipt.id, details: { number, lines: items.length } }, tx);
    return { receipt, duplicate: false };
  });
}

export async function recordSupplierInvoice(args: {
  supplierId: string;
  poId: string | null;
  invoiceRef: string;
  amountCents: number;
  issuedAt: Date;
  dueAt: Date | null;
  notes: string | null;
  userId: string;
}) {
  if (args.amountCents <= 0) throw new OrderError("Enter the invoice amount.");
  return db.transaction(async (tx) => {
    const exists = await tx.query.supplierInvoices.findFirst({ where: and(eq(schema.supplierInvoices.supplierId, args.supplierId), eq(schema.supplierInvoices.invoiceRef, args.invoiceRef.trim())) });
    if (exists) throw new OrderError("That invoice number is already recorded for this supplier.");
    const [inv] = await tx.insert(schema.supplierInvoices).values({ ...args, invoiceRef: args.invoiceRef.trim(), createdById: args.userId }).returning();
    await audit({ userId: args.userId, action: "supplier.invoice", entityType: "supplier_invoice", entityId: inv.id, details: { amountCents: args.amountCents } }, tx);
    return inv;
  });
}

export async function recordSupplierPayment(args: {
  supplierId: string;
  invoiceId: string | null;
  amountCents: number;
  method: "MPESA" | "CASH" | "BANK_TRANSFER" | "CARD" | "OTHER";
  reference: string | null;
  paidAt: Date;
  userId: string;
}) {
  if (args.amountCents <= 0) throw new OrderError("Enter the amount paid.");
  return db.transaction(async (tx) => {
    if (args.invoiceId) {
      const inv = (await tx.select().from(schema.supplierInvoices).where(eq(schema.supplierInvoices.id, args.invoiceId)).for("update"))[0];
      if (!inv || inv.supplierId !== args.supplierId) throw new OrderError("Invoice not found for this supplier.");
      const paid = await tx.execute<{ total: number }>(sql`select coalesce(sum(amount_cents),0)::int as total from supplier_payments where invoice_id = ${inv.id}`);
      const after = Number(paid.rows[0].total) + args.amountCents;
      if (after > inv.amountCents) throw new OrderError("That's more than is owed on the invoice.");
      await tx.update(schema.supplierInvoices).set({ status: after >= inv.amountCents ? "PAID" : "PARTIALLY_PAID" }).where(eq(schema.supplierInvoices.id, inv.id));
    }
    const [p] = await tx.insert(schema.supplierPayments).values({ ...args, createdById: args.userId }).returning();
    await audit({ userId: args.userId, action: "supplier.payment", entityType: "supplier", entityId: args.supplierId, details: { amountCents: args.amountCents, method: args.method } }, tx);
    return p;
  });
}

export async function supplierBalances() {
  const r = await db.execute<{ supplier_id: string; name: string; invoiced: number; paid: number }>(sql`
    select s.id as supplier_id, s.name,
      coalesce((select sum(amount_cents) from supplier_invoices i where i.supplier_id = s.id and i.status <> 'VOID'),0)::int as invoiced,
      coalesce((select sum(amount_cents) from supplier_payments p where p.supplier_id = s.id),0)::int as paid
    from suppliers s order by s.name`);
  return r.rows.map((x) => ({ supplierId: x.supplier_id, name: x.name, invoiced: Number(x.invoiced), paid: Number(x.paid), balance: Number(x.invoiced) - Number(x.paid) }));
}

export const PO_LABEL: Record<string, string> = { DRAFT: "Draft", ORDERED: "Sent to supplier", PARTIALLY_RECEIVED: "Part received", RECEIVED: "Received", CANCELLED: "Cancelled" };
