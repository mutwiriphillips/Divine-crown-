import { and, eq, gte, lt } from "drizzle-orm";
import { db, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth/server";
import { csvResponse, toCsv } from "@/lib/csv";
import { centsToDecimalString } from "@/lib/money";
import { presetRange } from "@/lib/reports";

export async function GET(req: Request) {
  const u = await getCurrentUser();
  if (!u?.isStaff || !u.permissions.includes("expenses.approve")) return new Response("Forbidden", { status: 403 });
  const sp = Object.fromEntries(new URL(req.url).searchParams.entries());
  const r = presetRange(sp.range ?? "month", sp.from, sp.to);
  const rows = await db.select({ e: schema.expenses, cat: schema.expenseCategories.name }).from(schema.expenses).innerJoin(schema.expenseCategories, eq(schema.expenseCategories.id, schema.expenses.categoryId)).where(and(gte(schema.expenses.date, r.from), lt(schema.expenses.date, r.to)));
  return csvResponse(`expenses-${r.from.toISOString().slice(0, 10)}.csv`, toCsv(rows.map(({ e, cat }) => ({ date: e.date.toISOString().slice(0, 10), category: cat, description: e.description, payee: e.payee, method: e.paymentMethod, reference: e.reference, amount_kes: centsToDecimalString(e.amountCents), status: e.status }))));
}
