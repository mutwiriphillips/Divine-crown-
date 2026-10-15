import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { checkClaims } from "@/lib/claims";

/** Publishing rules: reviewed, categorised, priced, and any flagged wording approved by the owner. */
export async function publishBlockers(productId: string): Promise<string[]> {
  const p = await db.query.products.findFirst({ where: eq(schema.products.id, productId), with: { variants: true } });
  if (!p) return ["Product not found."];
  const out: string[] = [];
  if (p.needsReview) out.push("Mark the product as reviewed once its details are checked.");
  if (!p.categoryId) out.push("Choose a category.");
  const sellable = p.variants.filter((v) => v.isActive && v.priceCents != null && v.priceCents > 0);
  if (!sellable.length) out.push("Set a price on at least one active variant.");
  if (p.variants.some((v) => v.isActive && v.priceCents != null && v.priceCents % 100 !== 0)) out.push("Prices must be whole shillings.");
  if (p.productType === "BUNDLE" || p.variants.some((v) => v.isBundle)) {
    for (const v of p.variants.filter((x) => x.isBundle && x.isActive)) {
      const comps = await db.select().from(schema.bundleItems).where(eq(schema.bundleItems.bundleVariantId, v.id));
      if (!comps.length) out.push(`Add the items included in "${v.name}".`);
    }
  }
  const flags = checkClaims({ name: p.name, description: p.description, usage: p.usageInstructions });
  if (flags.length && !p.claimsApproved) out.push(`The wording needs owner approval (${[...new Set(flags.map((f) => f.label))].join(", ")}).`);
  return out;
}


export const PRODUCT_CSV_COLUMNS = [
  "variant_id", "product_name", "brand", "category_slug", "product_type", "status", "variant_name", "sku", "barcode",
  "price_kes", "compare_at_kes", "wholesale_price_kes", "wholesale_min_qty", "reorder_level", "reorder_qty", "weight_grams", "needs_review",
];
