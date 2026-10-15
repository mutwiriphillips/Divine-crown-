/**
 * Base setup: roles, default location, categories, expense categories, settings, and the draft catalogue
 * built from the owner's photos. Safe to run more than once; existing records are left alone.
 *
 *   npm run db:seed
 *
 * This does NOT create any staff login. Create the owner account with:  npm run create-owner
 */
import "dotenv/config";
import "../src/lib/env-cleanup";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db, getPool, schema } from "@/db";
import { importImage } from "@/lib/media";
import { ROLE_DEFAULTS } from "@/lib/permissions";
import { saveSetting, getSetting } from "@/lib/settings";
import { CATEGORIES, LIBRARY_ONLY, PRODUCTS } from "./catalog-data";

async function seedRoles() {
  for (const [key, def] of Object.entries(ROLE_DEFAULTS)) {
    const existing = await db.query.roles.findFirst({ where: eq(schema.roles.key, key) });
    if (!existing) {
      await db.insert(schema.roles).values({ key, name: def.name, description: def.description, permissions: def.permissions, isStaff: def.isStaff });
    } else if (key === "OWNER") {
      // The owner always has every permission, including ones added in later versions.
      await db.update(schema.roles).set({ permissions: def.permissions }).where(eq(schema.roles.id, existing.id));
    }
  }
}

async function seedBasics() {
  const loc = await db.query.locations.findFirst();
  if (!loc) await db.insert(schema.locations).values({ name: "Main shop", code: "MAIN", isDefault: true });
  for (const name of ["Rent", "Utilities", "Transport", "Packaging", "Marketing", "Salaries", "Supplies", "Other"]) {
    await db.insert(schema.expenseCategories).values({ name }).onConflictDoNothing();
  }
  for (const c of CATEGORIES) {
    await db.insert(schema.categories).values(c).onConflictDoNothing({ target: schema.categories.slug });
  }
  // Write defaults once so they're visible/editable in the admin.
  await saveSetting("business", await getSetting("business"), null);
  await saveSetting("commerce", await getSetting("commerce"), null);
}

function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

async function seedCatalog(photoDir: string) {
  const marker = await db.query.settings.findFirst({ where: eq(schema.settings.key, "seed:catalog") });
  if (marker) {
    console.log("Catalogue already seeded; skipping.");
    return;
  }
  try {
    await access(path.join(photoDir, PRODUCTS.find((p) => p.images.length)!.images[0].file));
  } catch {
    throw new Error(`Product photos not found in ${photoDir}. Put the photos there or set SEED_PHOTOS_DIR to their folder.`);
  }
  const assetByFile = new Map<string, string>();
  const asset = async (file: string, note?: string) => {
    if (assetByFile.has(file)) return assetByFile.get(file)!;
    const prior = await db.query.mediaAssets.findFirst({ where: eq(schema.mediaAssets.originalName, file) });
    if (prior) {
      assetByFile.set(file, prior.id);
      return prior.id;
    }
    const buf = await readFile(path.join(photoDir, file));
    const a = await importImage(buf, { originalName: file, sourceNote: note ?? `Owner photo ${file}` });
    assetByFile.set(file, a.id);
    return a.id;
  };

  const cats = await db.select().from(schema.categories);
  const variantByKey = new Map<string, string>();
  for (const p of PRODUCTS) {
    const cat = cats.find((c) => c.slug === p.category);
    // Re-runnable: products created by an earlier, interrupted run are kept as they are.
    const existing = await db.query.products.findFirst({ where: eq(schema.products.slug, slugify(p.name)), with: { variants: true } });
    if (existing) {
      if (existing.variants[0]) variantByKey.set(p.key, existing.variants[0].id);
      const hasImages = await db.query.productImages.findFirst({ where: eq(schema.productImages.productId, existing.id) });
      if (!hasImages) await addImages(existing.id, p.images);
      console.log(`  = ${p.name} (already there)`);
      continue;
    }
    const [prod] = await db
      .insert(schema.products)
      .values({
        name: p.name,
        slug: slugify(p.name),
        brand: p.brand,
        categoryId: cat?.id ?? null,
        productType: p.productType,
        status: "DRAFT",
        needsReview: true,
        labelTranscript: p.labelTranscript,
        reviewNotes: p.reviewNotes,
        warnings: p.warnings ?? null,
        shippingRestriction: p.shippingRestriction ?? null,
      })
      .returning();
    const [v] = await db
      .insert(schema.productVariants)
      .values({
        productId: prod.id,
        name: p.variantName,
        priceCents: p.priceKES != null ? p.priceKES * 100 : null,
        isBundle: !!p.bundleOf,
        trackBatches: !!p.trackBatches,
      })
      .returning();
    variantByKey.set(p.key, v.id);
    await addImages(prod.id, p.images);
    console.log(`  + ${p.name}${p.images.length ? ` (${p.images.length} image${p.images.length > 1 ? "s" : ""})` : " (no image)"}`);
  }
  async function addImages(productId: string, images: (typeof PRODUCTS)[number]["images"]) {
    let order = 0;
    for (const im of images) {
      const assetId = await asset(im.file);
      await db.insert(schema.productImages).values({
        productId,
        assetId,
        alt: im.alt,
        sortOrder: order++,
        cropX: im.crop?.[0] ?? null,
        cropY: im.crop?.[1] ?? null,
        cropW: im.crop?.[2] ?? null,
        cropH: im.crop?.[3] ?? null,
      });
    }
  }
  for (const p of PRODUCTS.filter((x) => x.bundleOf)) {
    for (const b of p.bundleOf!) {
      await db.insert(schema.bundleItems).values({ bundleVariantId: variantByKey.get(p.key)!, componentVariantId: variantByKey.get(b.key)!, qty: b.qty }).onConflictDoNothing();
    }
  }
  for (const l of LIBRARY_ONLY) await asset(l.file, l.note);
  await db.insert(schema.settings).values({ key: "seed:catalog", value: { at: new Date().toISOString(), products: PRODUCTS.length } });
  console.log(`Seeded ${PRODUCTS.length} draft products and ${assetByFile.size} photos.`);
}

async function main() {
  await seedRoles();
  await seedBasics();
  await seedCatalog(process.env.SEED_PHOTOS_DIR ?? path.join(process.cwd(), "seed-photos"));
  await getPool().end();
}

main().catch(async (e) => {
  console.error(e);
  await getPool().end();
  process.exit(1);
});
