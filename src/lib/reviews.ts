import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";

const PURCHASED = sql`('PAID','PROCESSING','READY_FOR_COLLECTION','DISPATCHED','DELIVERED','COMPLETED','PARTIALLY_REFUNDED')`;

/** A customer can review a product once, after an order containing it has been paid. */
export async function productReviewEligibility(customerId: string | null, productId: string) {
  if (!customerId) return { eligible: false as const, reason: "signin" as const };
  const existing = await db.query.reviews.findFirst({ where: and(eq(schema.reviews.customerId, customerId), eq(schema.reviews.productId, productId), eq(schema.reviews.type, "PRODUCT")) });
  if (existing) return { eligible: false as const, reason: "already" as const, review: existing };
  const r = await db.execute<{ order_id: string }>(sql`
    select o.id as order_id from orders o join order_items oi on oi.order_id = o.id join product_variants v on v.id = oi.variant_id
     where o.customer_id = ${customerId} and v.product_id = ${productId} and o.status in ${PURCHASED}
     order by o.placed_at desc limit 1`);
  if (!r.rows[0]) return { eligible: false as const, reason: "not_purchased" as const };
  return { eligible: true as const, orderId: r.rows[0].order_id };
}

export async function orderReviewEligibility(customerId: string, orderId: string) {
  const o = await db.query.orders.findFirst({ where: and(eq(schema.orders.id, orderId), eq(schema.orders.customerId, customerId)) });
  if (!o) return { eligible: false };
  const done = ["COMPLETED", "DELIVERED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(o.status);
  const existing = await db.query.reviews.findMany({ where: and(eq(schema.reviews.customerId, customerId), eq(schema.reviews.orderId, orderId)) });
  return { eligible: done, order: o, existingTypes: existing.map((e) => e.type) };
}
