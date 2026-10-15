"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { action, dateField, moneyField, optStr, str, UserError } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/server";
import { MAX_UPLOAD_BYTES, sniffType, storage } from "@/lib/storage";

const METHODS = ["CASH", "MPESA", "BANK_TRANSFER", "CARD", "OTHER"] as const;

export const createExpenseAction = action(async (fd) => {
  const user = await requirePermission("expenses.create");
  const description = str(fd, "description");
  if (description.length < 3) throw new UserError("Describe the expense.");
  const method = str(fd, "paymentMethod") as (typeof METHODS)[number];
  if (!METHODS.includes(method)) throw new UserError("Choose how it was paid.");
  const amount = moneyField(fd, "amount", "amount", { required: true })!;
  if (amount <= 0) throw new UserError("Enter the amount.");
  let attachmentKey: string | null = null;
  const file = fd.get("attachment");
  if (file && typeof file === "object" && "arrayBuffer" in file && file.size > 0) {
    if (file.size > MAX_UPLOAD_BYTES) throw new UserError("Attachments must be 8 MB or smaller.");
    const buf = Buffer.from(await file.arrayBuffer());
    const t = sniffType(buf);
    if (!t) throw new UserError("Attach a PDF, JPEG, PNG or WebP file.");
    attachmentKey = `expenses/${crypto.randomUUID()}.${t.ext}`;
    await storage.put(attachmentKey, buf, t.mime, "private");
  }
  // Cash paid from an open till comes out of that drawer.
  let posSessionId: string | null = null;
  if (method === "CASH" && str(fd, "fromTill") === "on") {
    const s = await db.query.posSessions.findFirst({ where: and(eq(schema.posSessions.cashierId, user.id), eq(schema.posSessions.status, "OPEN")) });
    if (!s) throw new UserError("You don't have an open till shift to pay this from.");
    posSessionId = s.id;
  }
  const autoApprove = user.permissions.includes("expenses.approve");
  await db.transaction(async (tx) => {
    const [e] = await tx
      .insert(schema.expenses)
      .values({
        date: dateField(fd, "date") ?? new Date(),
        amountCents: amount,
        categoryId: str(fd, "categoryId"),
        payee: optStr(fd, "payee"),
        supplierId: optStr(fd, "supplierId"),
        paymentMethod: method,
        description,
        reference: optStr(fd, "reference"),
        attachmentKey,
        status: autoApprove ? "APPROVED" : "SUBMITTED",
        approvedById: autoApprove ? user.id : null,
        approvedAt: autoApprove ? new Date() : null,
        createdById: user.id,
        posSessionId,
      })
      .returning();
    if (posSessionId) await tx.insert(schema.cashMovements).values({ sessionId: posSessionId, type: "PAY_OUT", amountCents: -amount, reason: `Expense: ${description}`, refType: "EXPENSE", refId: e.id, userId: user.id });
    await audit({ userId: user.id, action: "expense.create", entityType: "expense", entityId: e.id, details: { amount, description } }, tx);
  });
  revalidatePath("/admin/expenses");
  return { ok: true, message: autoApprove ? "Expense recorded." : "Expense submitted for approval." };
});

export const reviewExpenseAction = action(async (fd) => {
  const user = await requirePermission("expenses.approve");
  const id = str(fd, "id");
  const op = str(fd, "op");
  const e = await db.query.expenses.findFirst({ where: eq(schema.expenses.id, id) });
  if (!e || e.status !== "SUBMITTED") throw new UserError("This expense has already been reviewed.");
  if (e.createdById === user.id && user.roleKey !== "OWNER") throw new UserError("Someone else needs to approve your own expense.");
  if (op === "reject" && !optStr(fd, "note")) throw new UserError("Note why it's rejected.");
  await db.update(schema.expenses).set({ status: op === "approve" ? "APPROVED" : "REJECTED", approvedById: user.id, approvedAt: new Date(), rejectionNote: op === "reject" ? optStr(fd, "note") : null }).where(eq(schema.expenses.id, id));
  await audit({ userId: user.id, action: `expense.${op}`, entityType: "expense", entityId: id });
  revalidatePath("/admin/expenses");
  return { ok: true, message: op === "approve" ? "Approved." : "Rejected." };
});

export const expenseCategoryAction = action(async (fd) => {
  await requirePermission("expenses.approve");
  const name = str(fd, "name");
  if (name.length < 2) throw new UserError("Name the category.");
  await db.insert(schema.expenseCategories).values({ name }).onConflictDoNothing();
  revalidatePath("/admin/expenses");
  return { ok: true, message: "Category added." };
});
