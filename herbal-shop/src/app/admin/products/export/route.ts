import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth/server";
import { csvResponse, toCsv } from "@/lib/csv";
import { centsToDecimalString } from "@/lib/money";
import { PRODUCT_CSV_COLUMNS } from "@/lib/products";



export async function GET() {
  const user = await getCurrentUser();
  if (!user?.isStaff || !user.permissions.includes("products.import")) return new Response("Forbidden", { status: 403 });
  const rows = await db
    .select({ v: schema.productVariants, p: schema.products, c: schema.categories })
    .from(schema.productVariants)
    .innerJoin(schema.products, eq(schema.products.id, schema.productVariants.productId))
    .leftJoin(schema.categories, eq(schema.categories.id, schema.products.categoryId))
    .orderBy(asc(schema.products.name), asc(schema.productVariants.sortOrder));
  const money = (c: number | null) => (c == null ? "" : centsToDecimalString(c));
  const csv = toCsv(
    rows.map(({ v, p, c }) => ({
      variant_id: v.id,
      product_name: p.name,
      brand: p.brand,
      category_slug: c?.slug ?? "",
      product_type: p.productType,
      status: p.status,
      variant_name: v.name,
      sku: v.sku,
      barcode: v.barcode,
      price_kes: money(v.priceCents),
      compare_at_kes: money(v.compareAtCents),
      wholesale_price_kes: money(v.wholesalePriceCents),
      wholesale_min_qty: v.wholesaleMinQty,
      reorder_level: v.reorderLevel,
      reorder_qty: v.reorderQty,
      weight_grams: v.weightGrams,
      needs_review: p.needsReview ? "yes" : "no",
    })),
    PRODUCT_CSV_COLUMNS,
  );
  await audit({ userId: user.id, action: "products.export", details: { rows: rows.length } });
  return csvResponse(`products-${new Date().toISOString().slice(0, 10)}.csv`, csv);
}
