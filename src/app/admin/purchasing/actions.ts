"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { action, dateField, moneyField, optStr, str, UserError } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { parseKESToCents } from "@/lib/money";
import { requirePermission } from "@/lib/auth/server";
import { createPurchaseOrder, receiveGoods, recordSupplierInvoice, recordSupplierPayment, setPurchaseOrderStatus } from "@/lib/purchasing";

function lines(fd: FormData) {
  const v = fd.getAll("variantId").map(String);
  const q = fd.getAll("qty").map(String);
  const c = fd.getAll("unitCost").map(String);
  return v
    .map((variantId, i) => {
      if (!variantId) return null;
      const qty = Number(q[i] || 0);
      let unitCostCents: number | null;
      try {
        unitCostCents = parseKESToCents(c[i]);
      } catch {
        throw new UserError(`Line ${i + 1}: enter a valid cost.`);
      }
      return { variantId, qty, unitCostCents: unitCostCents ?? 0 };
    })
    .filter((x): x is NonNullable<typeof x> => !!x && x.qty > 0);
}

export const createPoAction = action(async (fd) => {
  const user = await requirePermission("purchasing.manage");
  const po = await createPurchaseOrder({
    supplierId: str(fd, "supplierId"),
    locationId: str(fd, "locationId"),
    expectedAt: dateField(fd, "expectedAt"),
    notes: optStr(fd, "notes"),
    items: lines(fd).map((l) => ({ variantId: l.variantId, qty: l.qty, unitCostCents: l.unitCostCents })),
    userId: user.id,
  });
  redirect(`/admin/purchasing/${po.id}`);
});

export const poStatusAction = action(async (fd) => {
  const user = await requirePermission("purchasing.manage");
  const to = str(fd, "to") as "ORDERED" | "CANCELLED";
  await setPurchaseOrderStatus(str(fd, "poId"), to, user.id);
  revalidatePath(`/admin/purchasing/${str(fd, "poId")}`);
  return { ok: true, message: to === "ORDERED" ? "Marked as sent to supplier." : "Purchase order cancelled." };
});

export const receiveAction = action(async (fd) => {
  const user = await requirePermission("purchasing.receive");
  const poId = optStr(fd, "poId");
  const ids = fd.getAll("poItemId").map(String);
  const variants = fd.getAll("variantId").map(String);
  const qtys = fd.getAll("qty").map(String);
  const costs = fd.getAll("unitCost").map(String);
  const batches = fd.getAll("batchNo").map(String);
  const expiries = fd.getAll("expiresAt").map(String);
  const items = variants
    .map((variantId, i) => {
      if (!variantId) return null;
      const qty = Number(qtys[i] || 0);
      if (!Number.isInteger(qty) || qty < 0) throw new UserError(`Line ${i + 1}: quantity must be a whole number.`);
      let cost: number | null;
      try {
        cost = parseKESToCents(costs[i]);
      } catch {
        throw new UserError(`Line ${i + 1}: enter a valid cost.`);
      }
      if (qty > 0 && cost == null) throw new UserError(`Line ${i + 1}: enter the cost per unit.`);
      return {
        poItemId: ids[i] || null,
        variantId,
        qty,
        unitCostCents: cost ?? 0,
        batchNo: batches[i]?.trim() || null,
        expiresAt: expiries[i] ? new Date(`${expiries[i]}T00:00:00+03:00`) : null,
      };
    })
    .filter((x): x is NonNullable<typeof x> => !!x && x.qty > 0);
  const r = await receiveGoods({
    idempotencyKey: str(fd, "idempotencyKey"),
    poId,
    supplierId: str(fd, "supplierId"),
    locationId: str(fd, "locationId"),
    supplierInvoiceRef: optStr(fd, "supplierInvoiceRef"),
    notes: optStr(fd, "notes"),
    items,
    userId: user.id,
  });
  revalidatePath("/admin/purchasing");
  if (poId) revalidatePath(`/admin/purchasing/${poId}`);
  return { ok: true, message: r.duplicate ? `Already received as ${r.receipt.number} — stock was not added twice.` : `Received as ${r.receipt.number}. Stock updated.` };
});

export const supplierAction = action(async (fd) => {
  const user = await requirePermission("purchasing.manage");
  const name = str(fd, "name");
  if (name.length < 2) throw new UserError("Enter the supplier's name.");
  const values = { name, contactName: optStr(fd, "contactName"), phone: optStr(fd, "phone"), email: optStr(fd, "email"), address: optStr(fd, "address"), notes: optStr(fd, "notes"), isActive: str(fd, "isActive") !== "off" };
  const id = optStr(fd, "id");
  if (id) await db.update(schema.suppliers).set(values).where(eq(schema.suppliers.id, id));
  else {
    const [s] = await db.insert(schema.suppliers).values(values).returning();
    await audit({ userId: user.id, action: "supplier.create", entityType: "supplier", entityId: s.id });
    redirect(`/admin/suppliers/${s.id}`);
  }
  revalidatePath(`/admin/suppliers/${id}`);
  return { ok: true, message: "Supplier saved." };
});

export const supplierInvoiceAction = action(async (fd) => {
  const user = await requirePermission("purchasing.pay");
  await recordSupplierInvoice({
    supplierId: str(fd, "supplierId"),
    poId: optStr(fd, "poId"),
    invoiceRef: str(fd, "invoiceRef"),
    amountCents: moneyField(fd, "amount", "amount", { required: true })!,
    issuedAt: dateField(fd, "issuedAt") ?? new Date(),
    dueAt: dateField(fd, "dueAt"),
    notes: optStr(fd, "notes"),
    userId: user.id,
  });
  revalidatePath(`/admin/suppliers/${str(fd, "supplierId")}`);
  return { ok: true, message: "Invoice recorded." };
});

export const supplierPaymentAction = action(async (fd) => {
  const user = await requirePermission("purchasing.pay");
  const method = str(fd, "method") as "MPESA";
  if (!["MPESA", "CASH", "BANK_TRANSFER", "CARD", "OTHER"].includes(method)) throw new UserError("Choose a payment method.");
  await recordSupplierPayment({
    supplierId: str(fd, "supplierId"),
    invoiceId: optStr(fd, "invoiceId"),
    amountCents: moneyField(fd, "amount", "amount", { required: true })!,
    method,
    reference: optStr(fd, "reference"),
    paidAt: dateField(fd, "paidAt") ?? new Date(),
    userId: user.id,
  });
  revalidatePath(`/admin/suppliers/${str(fd, "supplierId")}`);
  return { ok: true, message: "Payment recorded." };
});
