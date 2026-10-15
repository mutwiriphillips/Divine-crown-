"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { action, bool, UserError } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/server";
import { parseCsv } from "@/lib/csv";
import { parseKESToCents } from "@/lib/money";
import { slugify } from "@/lib/text";

const TYPES = schema.productType.enumValues as readonly string[];

/**
 * CSV import. Rows match an existing variant by variant_id, then by SKU; unmatched rows create new
 * draft products. Status is never changed by import: publishing always goes through the review checks.
 * Prices must be whole shillings. With "Check only", nothing is saved.
 */
export const importProductsAction = action(async (fd) => {
  const user = await requirePermission("products.import");
  const file = fd.get("file");
  if (!file || typeof file === "string" || file.size === 0) throw new UserError("Choose a CSV file.");
  if (file.size > 2 * 1024 * 1024) throw new UserError("The file is larger than 2 MB. Split it into smaller files.");
  const dryRun = bool(fd, "dryRun");
  const { rows, errors: parseErrors } = parseCsv(await file.text());
  if (parseErrors.length) throw new UserError(`The file couldn't be read: ${parseErrors.join("; ")}`);
  if (!rows.length) throw new UserError("The file has no rows.");
  if (rows.length > 2000) throw new UserError("Import up to 2,000 rows at a time.");
  const cats = await db.select().from(schema.categories);
  const problems: string[] = [];
  let created = 0;
  let updated = 0;

  const money = (v: string | undefined, rowNo: number, col: string) => {
    if (v === undefined || v.trim() === "") return undefined;
    try {
      const c = parseKESToCents(v);
      if (c === null) return null;
      if (c < 0 || c % 100 !== 0) throw new Error();
      return c;
    } catch {
      problems.push(`Row ${rowNo}: ${col} "${v}" must be a whole-shilling amount.`);
      return undefined;
    }
  };
  const intVal = (v: string | undefined, rowNo: number, col: string) => {
    if (v === undefined || v.trim() === "") return undefined;
    if (!/^\d+$/.test(v.trim())) {
      problems.push(`Row ${rowNo}: ${col} must be a whole number.`);
      return undefined;
    }
    return Number(v.trim());
  };

  await db.transaction(async (tx) => {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const rowNo = i + 2;
      const sku = r.sku?.trim().toUpperCase() || null;
      let variant = r.variant_id?.trim() ? await tx.query.productVariants.findFirst({ where: eq(schema.productVariants.id, r.variant_id.trim()) }).catch(() => undefined) : undefined;
      if (!variant && sku) variant = await tx.query.productVariants.findFirst({ where: eq(schema.productVariants.sku, sku) });
      const cat = r.category_slug?.trim() ? cats.find((c) => c.slug === r.category_slug.trim()) : undefined;
      if (r.category_slug?.trim() && !cat) problems.push(`Row ${rowNo}: unknown category "${r.category_slug}". Use a slug from Categories.`);
      const type = r.product_type?.trim().toUpperCase();
      if (type && !TYPES.includes(type)) problems.push(`Row ${rowNo}: unknown product type "${r.product_type}".`);
      const v = {
        priceCents: money(r.price_kes, rowNo, "price_kes"),
        compareAtCents: money(r.compare_at_kes, rowNo, "compare_at_kes"),
        wholesalePriceCents: money(r.wholesale_price_kes, rowNo, "wholesale_price_kes"),
        wholesaleMinQty: intVal(r.wholesale_min_qty, rowNo, "wholesale_min_qty"),
        reorderLevel: intVal(r.reorder_level, rowNo, "reorder_level"),
        reorderQty: intVal(r.reorder_qty, rowNo, "reorder_qty"),
        weightGrams: intVal(r.weight_grams, rowNo, "weight_grams"),
        barcode: r.barcode?.trim() || undefined,
        name: r.variant_name?.trim() || undefined,
        sku: sku ?? undefined,
      };
      const clean = Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined));
      if (variant) {
        if (Object.keys(clean).length) await tx.update(schema.productVariants).set(clean).where(eq(schema.productVariants.id, variant.id));
        const pPatch: Record<string, unknown> = {};
        if (r.product_name?.trim()) pPatch.name = r.product_name.trim();
        if (r.brand !== undefined) pPatch.brand = r.brand.trim() || null;
        if (cat) pPatch.categoryId = cat.id;
        if (type && TYPES.includes(type)) pPatch.productType = type;
        if (Object.keys(pPatch).length) await tx.update(schema.products).set(pPatch).where(eq(schema.products.id, variant.productId));
        updated++;
      } else {
        const name = r.product_name?.trim();
        if (!name) {
          problems.push(`Row ${rowNo}: new rows need a product_name.`);
          continue;
        }
        let slug = slugify(name);
        if (await tx.query.products.findFirst({ where: eq(schema.products.slug, slug) })) slug = `${slug}-${Math.floor(Math.random() * 1e5)}`;
        const [p] = await tx
          .insert(schema.products)
          .values({ name, slug, brand: r.brand?.trim() || null, categoryId: cat?.id ?? null, productType: (type && TYPES.includes(type) ? type : "OTHER") as "OTHER", status: "DRAFT", needsReview: true })
          .returning();
        await tx.insert(schema.productVariants).values({ productId: p.id, ...clean, name: v.name ?? "Standard" });
        created++;
      }
    }
    if (problems.length) throw new UserError(`Nothing was imported. Fix these and try again: ${problems.slice(0, 15).join(" ")}${problems.length > 15 ? ` …and ${problems.length - 15} more.` : ""}`);
    if (dryRun) throw new DryRun(created, updated);
  }).catch((e) => {
    if (e instanceof DryRun) return;
    throw e;
  });
  if (dryRun) return { ok: true, message: `Check passed: ${created} new product(s) and ${updated} update(s) would be made. Nothing has been saved yet.` };
  await audit({ userId: user.id, action: "products.import", details: { created, updated } });
  revalidatePath("/admin/products");
  return { ok: true, message: `Imported: ${created} new draft product(s), ${updated} updated.` };
});

class DryRun extends Error {
  constructor(
    public created: number,
    public updated: number,
  ) {
    super("dry run");
  }
}
