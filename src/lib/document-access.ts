import "server-only";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth/server";
import { canAccessOrder } from "@/lib/order-access";

export async function loadDocumentForViewer(id: string, key: string | null) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const doc = await db.query.documents.findFirst({ where: eq(schema.documents.id, id), with: { order: true } });
  if (!doc || !(await canAccessOrder(doc.order, key))) return null;
  const u = await getCurrentUser();
  const staff = !!u?.isStaff;
  if (staff) {
    // Reprints are counted, never re-issued.
    await db.update(schema.documents).set({ printCount: sql`${schema.documents.printCount} + 1`, lastPrintedAt: new Date() }).where(eq(schema.documents.id, id));
  }
  return { doc, staff };
}
