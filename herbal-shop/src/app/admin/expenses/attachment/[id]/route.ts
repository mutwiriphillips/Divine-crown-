import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth/server";
import { sniffType, storage } from "@/lib/storage";

/** Expense receipts live in private storage and are only served to authorised staff. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await getCurrentUser();
  const { id } = await params;
  if (!u?.isStaff || !/^[0-9a-f-]{36}$/.test(id)) return new Response("Not found", { status: 404 });
  const e = await db.query.expenses.findFirst({ where: eq(schema.expenses.id, id) });
  if (!e?.attachmentKey || !(u.permissions.includes("expenses.approve") || e.createdById === u.id)) return new Response("Not found", { status: 404 });
  const buf = await storage.get(e.attachmentKey, "private");
  if (!buf) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(buf), { headers: { "Content-Type": sniffType(buf)?.mime ?? "application/octet-stream", "Content-Disposition": "inline", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
