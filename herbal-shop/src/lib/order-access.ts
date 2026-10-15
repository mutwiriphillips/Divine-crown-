import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth/server";
import { safeEqual, sha256 } from "@/lib/crypto";

type Order = typeof schema.orders.$inferSelect;

/**
 * Who may see an order: staff with orders.view (or the cashier for POS receipts), the signed-in customer
 * who owns it, or anyone holding the private link key sent to the customer.
 */
export async function canAccessOrder(order: Order, key?: string | null): Promise<boolean> {
  if (key && order.accessTokenHash && safeEqual(sha256(key), order.accessTokenHash)) return true;
  const u = await getCurrentUser();
  if (!u) return false;
  if (u.isStaff && (u.permissions.includes("orders.view") || u.permissions.includes("pos.use"))) return true;
  if (!order.customerId) return false;
  const c = await db.query.customers.findFirst({ where: eq(schema.customers.userId, u.id) });
  return !!c && c.id === order.customerId;
}

export async function findOrderByNumber(number: string) {
  if (!/^[A-Z]{2,4}-\d{3,10}$/.test(number)) return null;
  return (await db.query.orders.findFirst({ where: eq(schema.orders.number, number) })) ?? null;
}
