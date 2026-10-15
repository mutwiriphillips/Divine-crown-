"use server";

import { asc, eq, inArray, max, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { action, bool, moneyField, optInt, optStr, str, UserError } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { clientIp, requirePermission } from "@/lib/auth/server";
import { checkClaims } from "@/lib/claims";
import { importImage } from "@/lib/media";
import { slugify } from "@/lib/text";
import { publishBlockers } from "@/lib/products";

async function uniqueSlug(base: string, excludeId?: string) {
  let slug = slugify(base);
  for (let i = 2; i < 100; i++) {
    const clash = await db.query.products.findFirst({ where: eq(schema.products.slug, slug) });
    if (!clash || clash.id === excludeId) return slug;
    slug = `${slugify(base)}-${i}`;
  }
  return `${slugify(base)}-${Date.now()}`;
}

const TYPES = schema.productType.enumValues;
const TAX = schema.taxCategory.enumValues;

export const createProductAction = action(async (fd) => {
  const user = await requirePermission("products.edit");
  const name = str(fd, "name");
  if (name.length < 2) throw new UserError("Enter a product name.", { name: "Required." });
  const type = str(fd, "productType") as (typeof TYPES)[number];
  if (!TYPES.includes(type)) throw new UserError("Choose a product type.");
  const [p] = await db
    .insert(schema.products)
    .values({ name, slug: await uniqueSlug(name), categoryId: optStr(fd, "categoryId"), productType: type, status: "DRAFT", needsReview: true })
    .returning();
  await db.insert(schema.productVariants).values({ productId: p.id, name: str(fd, "variantName") || "Standard", isBundle: type === "BUNDLE" });
  await audit({ userId: user.id, action: "product.create", entityType: "product", entityId: p.id, details: { name } });
  redirect(`/admin/products/${p.id}`);
});

export const updateProductAction = action(async (fd) => {
  const user = await requirePermission("products.edit");
  const id = str(fd, "id");
  const p = await db.query.products.findFirst({ where: eq(schema.products.id, id) });
  if (!p) throw new UserError("Product not found.");
  const name = str(fd, "name");
  if (name.length < 2) throw new UserError("Enter a product name.", { name: "Required." });
  const type = str(fd, "productType") as (typeof TYPES)[number];
  const tax = str(fd, "taxCategory") as (typeof TAX)[number];
  if (!TYPES.includes(type) || !TAX.includes(tax)) throw new UserError("Choose a product type and tax category.");
  const description = optStr(fd, "description");
  const usageInstructions = optStr(fd, "usageInstructions");
  const before = checkClaims({ name: p.name, description: p.description, usage: p.usageInstructions });
  const after = checkClaims({ name, description, usage: usageInstructions });
  const wordingChanged = name !== p.name || description !== p.description || usageInstructions !== p.usageInstructions;
  // Approval covers the exact wording that was reviewed; new flagged wording needs a fresh review.
  const resetApproval = wordingChanged && after.length > 0 && JSON.stringify(after) !== JSON.stringify(before);
  const slugInput = str(fd, "slug");
  const values = {
    name,
    slug: slugInput ? await uniqueSlug(slugInput, id) : p.slug,
    brand: optStr(fd, "brand"),
    categoryId: optStr(fd, "categoryId"),
    productType: type,
    description,
    usageInstructions,
    warnings: optStr(fd, "warnings"),
    ingredients: optStr(fd, "ingredients"),
    ingredientsVerified: bool(fd, "ingredientsVerified"),
    shippingRestriction: optStr(fd, "shippingRestriction"),
    taxCategory: tax,
    reviewNotes: optStr(fd, "reviewNotes"),
    labelTranscript: optStr(fd, "labelTranscript"),
    defaultSupplierId: optStr(fd, "defaultSupplierId"),
    isFeatured: bool(fd, "isFeatured"),
    claimsApproved: resetApproval ? false : p.claimsApproved,
  };
  if (values.ingredientsVerified && !values.ingredients) throw new UserError("Add the ingredients before marking them verified.");
  await db.update(schema.products).set(values).where(eq(schema.products.id, id));
  await audit({ userId: user.id, action: "product.update", entityType: "product", entityId: id, details: { resetClaimsApproval: resetApproval } });
  revalidatePath(`/admin/products/${id}`);
  return { ok: true, message: resetApproval ? "Saved. The new wording needs claims approval again before the product can be published." : "Saved." };
});

export const setStatusAction = action(async (fd) => {
  const user = await requirePermission("products.publish");
  const id = str(fd, "id");
  const to = str(fd, "status") as "DRAFT" | "PUBLISHED" | "ARCHIVED";
  if (!["DRAFT", "PUBLISHED", "ARCHIVED"].includes(to)) throw new UserError("Unknown status.");
  if (to === "PUBLISHED") {
    const blockers = await publishBlockers(id);
    if (blockers.length) throw new UserError(`Not published yet: ${blockers.join(" ")}`);
  }
  const publishAt = to === "PUBLISHED" && str(fd, "publishAt") ? new Date(`${str(fd, "publishAt")}+03:00`) : null;
  await db
    .update(schema.products)
    .set({ status: to, publishAt, archivedAt: to === "ARCHIVED" ? new Date() : null })
    .where(eq(schema.products.id, id));
  await audit({ userId: user.id, action: `product.${to.toLowerCase()}`, entityType: "product", entityId: id, details: { publishAt } });
  revalidatePath(`/admin/products/${id}`);
  return { ok: true, message: to === "PUBLISHED" ? (publishAt && publishAt > new Date() ? "Scheduled." : "Published.") : to === "ARCHIVED" ? "Archived. It stays in past orders and reports." : "Moved to draft." };
});

export const markReviewedAction = action(async (fd) => {
  const user = await requirePermission("products.edit");
  const id = str(fd, "id");
  const reviewed = str(fd, "reviewed") === "1";
  await db.update(schema.products).set({ needsReview: !reviewed }).where(eq(schema.products.id, id));
  await audit({ userId: user.id, action: reviewed ? "product.reviewed" : "product.needs_review", entityType: "product", entityId: id });
  revalidatePath(`/admin/products/${id}`);
  return { ok: true, message: reviewed ? "Marked as reviewed." : "Flagged for review." };
});

export const approveClaimsAction = action(async (fd) => {
  const user = await requirePermission("products.approve_claims");
  const id = str(fd, "id");
  const note = str(fd, "note");
  if (note.length < 10) throw new UserError("Explain the basis for approving this wording (e.g. registration number, or that it's described as a traditional product only).", { note: "At least 10 characters." });
  const p = await db.query.products.findFirst({ where: eq(schema.products.id, id) });
  if (!p) throw new UserError("Product not found.");
  const flags = checkClaims({ name: p.name, description: p.description, usage: p.usageInstructions });
  await db.update(schema.products).set({ claimsApproved: true, claimsApprovalNote: note }).where(eq(schema.products.id, id));
  await audit({ userId: user.id, action: "product.claims_approved", entityType: "product", entityId: id, details: { note, flags } });
  revalidatePath(`/admin/products/${id}`);
  return { ok: true, message: "Wording approved." };
});

export const saveVariantAction = action(async (fd) => {
  const user = await requirePermission("products.edit");
  const productId = str(fd, "productId");
  const variantId = optStr(fd, "variantId");
  const priceCents = moneyField(fd, "price", "price", { wholeShillings: true });
  const compareAtCents = moneyField(fd, "compareAt", "compare-at price", { wholeShillings: true });
  if (compareAtCents != null && (priceCents == null || compareAtCents <= priceCents)) {
    throw new UserError("A 'was' price must be higher than the current price, or leave it empty.", { compareAt: "Must be above the price." });
  }
  const values = {
    productId,
    name: str(fd, "name") || "Standard",
    sku: optStr(fd, "sku")?.toUpperCase() ?? null,
    barcode: optStr(fd, "barcode"),
    priceCents,
    compareAtCents,
    wholesalePriceCents: moneyField(fd, "wholesalePrice", "wholesale price", { wholeShillings: true }),
    wholesaleMinQty: Math.max(1, optInt(fd, "wholesaleMinQty", "wholesale minimum") ?? 1),
    reorderLevel: Math.max(0, optInt(fd, "reorderLevel", "reorder level") ?? 0),
    reorderQty: Math.max(0, optInt(fd, "reorderQty", "reorder quantity") ?? 0),
    weightGrams: optInt(fd, "weightGrams", "weight"),
    trackBatches: bool(fd, "trackBatches"),
    isActive: fd.has("isActive") ? fd.getAll("isActive").includes("on") : true,
  };
  if (variantId) {
    const old = await db.query.productVariants.findFirst({ where: eq(schema.productVariants.id, variantId) });
    if (!old || old.productId !== productId) throw new UserError("Variant not found.");
    await db.update(schema.productVariants).set(values).where(eq(schema.productVariants.id, variantId));
    if (old.priceCents !== values.priceCents) {
      await audit({ userId: user.id, action: "price.change", entityType: "variant", entityId: variantId, details: { from: old.priceCents, to: values.priceCents }, ip: await clientIp() });
    }
  } else {
    const p = await db.query.products.findFirst({ where: eq(schema.products.id, productId) });
    const [v] = await db.insert(schema.productVariants).values({ ...values, isBundle: p?.productType === "BUNDLE" }).returning();
    await audit({ userId: user.id, action: "variant.create", entityType: "variant", entityId: v.id });
  }
  revalidatePath(`/admin/products/${productId}`);
  return { ok: true, message: variantId ? "Variant saved." : "Variant added." };
});

export const generateSkuAction = action(async (fd) => {
  await requirePermission("products.edit");
  const variantId = str(fd, "variantId");
  const v = await db.query.productVariants.findFirst({ where: eq(schema.productVariants.id, variantId), with: { product: true } });
  if (!v) throw new UserError("Variant not found.");
  if (v.sku) throw new UserError("This variant already has a SKU.");
  const prefix = slugify(v.product.name).split("-").filter(Boolean).slice(0, 3).map((w) => w[0]).join("").toUpperCase().padEnd(3, "X");
  for (let i = 0; i < 20; i++) {
    const sku = `${prefix}-${String(Math.floor(1000 + Math.random() * 9000))}`;
    const clash = await db.query.productVariants.findFirst({ where: eq(schema.productVariants.sku, sku) });
    if (!clash) {
      await db.update(schema.productVariants).set({ sku }).where(eq(schema.productVariants.id, variantId));
      revalidatePath(`/admin/products/${v.productId}`);
      return { ok: true, message: `SKU ${sku} assigned.` };
    }
  }
  throw new UserError("Couldn't generate a free SKU; enter one manually.");
});

export const saveBundleAction = action(async (fd) => {
  const user = await requirePermission("products.edit");
  const bundleVariantId = str(fd, "bundleVariantId");
  const productId = str(fd, "productId");
  const components = fd.getAll("componentVariantId").map(String);
  const qtys = fd.getAll("componentQty").map(String);
  const rows = components
    .map((c, i) => ({ componentVariantId: c, qty: Number(qtys[i]) }))
    .filter((r) => r.componentVariantId && Number.isInteger(r.qty) && r.qty > 0);
  if (rows.some((r) => r.componentVariantId === bundleVariantId)) throw new UserError("A bundle can't contain itself.");
  const comps = rows.length ? await db.select().from(schema.productVariants).where(inArray(schema.productVariants.id, rows.map((r) => r.componentVariantId))) : [];
  if (comps.some((c) => c.isBundle)) throw new UserError("Bundles can't contain other bundles.");
  await db.transaction(async (tx) => {
    await tx.delete(schema.bundleItems).where(eq(schema.bundleItems.bundleVariantId, bundleVariantId));
    const merged = new Map<string, number>();
    for (const r of rows) merged.set(r.componentVariantId, (merged.get(r.componentVariantId) ?? 0) + r.qty);
    if (merged.size) await tx.insert(schema.bundleItems).values([...merged].map(([componentVariantId, qty]) => ({ bundleVariantId, componentVariantId, qty })));
  });
  await audit({ userId: user.id, action: "bundle.update", entityType: "variant", entityId: bundleVariantId, details: { rows } });
  revalidatePath(`/admin/products/${productId}`);
  return { ok: true, message: "Bundle contents saved." };
});

export const uploadImagesAction = action(async (fd) => {
  const user = await requirePermission("products.edit");
  const productId = str(fd, "productId");
  const files = fd.getAll("files").filter((f): f is File => typeof f === "object" && "arrayBuffer" in f && f.size > 0);
  if (!files.length) throw new UserError("Choose one or more images.");
  if (files.length > 12) throw new UserError("Upload up to 12 images at a time.");
  const top = await db.select({ m: max(schema.productImages.sortOrder) }).from(schema.productImages).where(eq(schema.productImages.productId, productId));
  let order = (top[0]?.m ?? -1) + 1;
  const product = await db.query.products.findFirst({ where: eq(schema.products.id, productId) });
  for (const f of files) {
    const asset = await importImage(Buffer.from(await f.arrayBuffer()), { originalName: f.name.slice(0, 120), sourceNote: `Uploaded by ${user.name}` });
    await db.insert(schema.productImages).values({ productId, assetId: asset.id, alt: product?.name ?? null, sortOrder: order++ });
  }
  await audit({ userId: user.id, action: "product.images_upload", entityType: "product", entityId: productId, details: { count: files.length } });
  revalidatePath(`/admin/products/${productId}`);
  return { ok: true, message: `${files.length} image${files.length > 1 ? "s" : ""} added.` };
});

export const attachLibraryImageAction = action(async (fd) => {
  await requirePermission("products.edit");
  const productId = str(fd, "productId");
  const assetId = str(fd, "assetId");
  const top = await db.select({ m: max(schema.productImages.sortOrder) }).from(schema.productImages).where(eq(schema.productImages.productId, productId));
  await db.insert(schema.productImages).values({ productId, assetId, sortOrder: (top[0]?.m ?? -1) + 1 }).onConflictDoNothing();
  revalidatePath(`/admin/products/${productId}`);
  return { ok: true, message: "Image added." };
});

export const imageAction = action(async (fd) => {
  await requirePermission("products.edit");
  const imageId = str(fd, "imageId");
  const op = str(fd, "op");
  const img = await db.query.productImages.findFirst({ where: eq(schema.productImages.id, imageId) });
  if (!img) throw new UserError("Image not found.");
  const all = await db.select().from(schema.productImages).where(eq(schema.productImages.productId, img.productId)).orderBy(asc(schema.productImages.sortOrder));
  if (op === "remove") {
    // Removes it from this product only; the photo stays in the image library.
    await db.delete(schema.productImages).where(eq(schema.productImages.id, imageId));
  } else if (op === "up" || op === "down" || op === "first") {
    const idx = all.findIndex((x) => x.id === imageId);
    const reordered = [...all];
    const [item] = reordered.splice(idx, 1);
    const to = op === "first" ? 0 : op === "up" ? Math.max(0, idx - 1) : Math.min(all.length - 1, idx + 1);
    reordered.splice(to, 0, item);
    await db.transaction(async (tx) => {
      for (let i = 0; i < reordered.length; i++) await tx.update(schema.productImages).set({ sortOrder: i }).where(eq(schema.productImages.id, reordered[i].id));
    });
  } else if (op === "alt") {
    await db.update(schema.productImages).set({ alt: optStr(fd, "alt") }).where(eq(schema.productImages.id, imageId));
  } else if (op === "crop") {
    const nums = ["cropX", "cropY", "cropW", "cropH"].map((k) => Number(str(fd, k)));
    const clear = str(fd, "clear") === "1" || nums.some((n) => !Number.isFinite(n)) || nums[2] < 0.02 || nums[3] < 0.02;
    const [x, y, w, h] = nums.map((n) => Math.min(1, Math.max(0, n)));
    await db
      .update(schema.productImages)
      .set(clear ? { cropX: null, cropY: null, cropW: null, cropH: null } : { cropX: x, cropY: y, cropW: Math.min(w, 1 - x), cropH: Math.min(h, 1 - y) })
      .where(eq(schema.productImages.id, imageId));
  } else throw new UserError("Unknown image operation.");
  revalidatePath(`/admin/products/${img.productId}`);
  return { ok: true, message: "Image updated." };
});

export const bulkProductsAction = action(async (fd) => {
  const user = await requirePermission("products.edit");
  const ids = fd.getAll("ids").map(String).filter(Boolean);
  const op = str(fd, "op");
  if (!ids.length) throw new UserError("Select at least one product.");
  if (op === "feature" || op === "unfeature") {
    await db.update(schema.products).set({ isFeatured: op === "feature" }).where(inArray(schema.products.id, ids));
  } else if (op === "category") {
    const categoryId = optStr(fd, "categoryId");
    if (!categoryId) throw new UserError("Choose a category to move them to.");
    await db.update(schema.products).set({ categoryId }).where(inArray(schema.products.id, ids));
  } else if (op === "draft" || op === "archive") {
    await requirePermission("products.publish");
    await db
      .update(schema.products)
      .set({ status: op === "draft" ? "DRAFT" : "ARCHIVED", archivedAt: op === "archive" ? new Date() : null })
      .where(inArray(schema.products.id, ids));
  } else if (op === "publish") {
    await requirePermission("products.publish");
    const blocked: string[] = [];
    for (const id of ids) {
      const b = await publishBlockers(id);
      if (b.length) {
        const p = await db.query.products.findFirst({ where: eq(schema.products.id, id), columns: { name: true } });
        blocked.push(p?.name ?? id);
      } else await db.update(schema.products).set({ status: "PUBLISHED", archivedAt: null }).where(eq(schema.products.id, id));
    }
    await audit({ userId: user.id, action: "product.bulk_publish", details: { ids, blocked } });
    revalidatePath("/admin/products");
    return blocked.length
      ? { ok: false, message: `Published ${ids.length - blocked.length}. Not ready to publish: ${blocked.join(", ")}. Open each to see what's missing.` }
      : { ok: true, message: `Published ${ids.length}.` };
  } else throw new UserError("Choose an action.");
  await audit({ userId: user.id, action: `product.bulk_${op}`, details: { ids } });
  revalidatePath("/admin/products");
  return { ok: true, message: `Updated ${ids.length} product${ids.length > 1 ? "s" : ""}.` };
});

export const categoryAction = action(async (fd) => {
  const user = await requirePermission("products.edit");
  const id = optStr(fd, "id");
  const op = str(fd, "op") || "save";
  if (op === "toggle" && id) {
    await db.update(schema.categories).set({ isActive: sql`not ${schema.categories.isActive}` }).where(eq(schema.categories.id, id));
  } else {
    const name = str(fd, "name");
    if (name.length < 2) throw new UserError("Enter a category name.", { name: "Required." });
    const parentId = optStr(fd, "parentId");
    if (parentId && parentId === id) throw new UserError("A category can't be its own parent.");
    const values = { name, description: optStr(fd, "description"), parentId, sortOrder: optInt(fd, "sortOrder", "sort order") ?? 0 };
    if (id) await db.update(schema.categories).set(values).where(eq(schema.categories.id, id));
    else {
      let slug = slugify(name);
      if (await db.query.categories.findFirst({ where: eq(schema.categories.slug, slug) })) slug = `${slug}-${Date.now() % 10000}`;
      await db.insert(schema.categories).values({ ...values, slug });
    }
  }
  await audit({ userId: user.id, action: "category.save", entityType: "category", entityId: id ?? undefined });
  revalidatePath("/admin/categories");
  return { ok: true, message: "Category saved." };
});

export const uploadLibraryAction = action(async (fd) => {
  const user = await requirePermission("products.edit");
  const files = fd.getAll("files").filter((f): f is File => typeof f === "object" && "arrayBuffer" in f && f.size > 0);
  if (!files.length) throw new UserError("Choose one or more images.");
  for (const f of files.slice(0, 20)) await importImage(Buffer.from(await f.arrayBuffer()), { originalName: f.name.slice(0, 120), sourceNote: `Uploaded by ${user.name}` });
  revalidatePath("/admin/media");
  return { ok: true, message: `${Math.min(files.length, 20)} image(s) added to the library.` };
});

export const assetCaptionAction = action(async (fd) => {
  await requirePermission("products.edit");
  await db.update(schema.mediaAssets).set({ caption: optStr(fd, "caption") }).where(eq(schema.mediaAssets.id, str(fd, "assetId")));
  revalidatePath("/admin/media");
  return { ok: true, message: "Saved." };
});

