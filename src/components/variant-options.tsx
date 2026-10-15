import { asc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";

export async function stockVariants() {
  return db
    .select({ id: schema.productVariants.id, name: schema.productVariants.name, product: schema.products.name, sku: schema.productVariants.sku, cost: schema.productVariants.avgCostCents, supplierId: schema.products.defaultSupplierId })
    .from(schema.productVariants)
    .innerJoin(schema.products, eq(schema.products.id, schema.productVariants.productId))
    .where(sql`not ${schema.productVariants.isBundle} and ${schema.products.status} <> 'ARCHIVED'`)
    .orderBy(asc(schema.products.name));
}
