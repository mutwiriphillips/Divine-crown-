import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireStaffPage } from "@/lib/auth/server";
import { checkClaims, STANDARD_DISCLAIMERS } from "@/lib/claims";
import { imageCrop, mediaUrl } from "@/lib/media";
import { Badge, Field, fmtDate, Money, Notice, PageHeader } from "@/components/ui";
import { ActionForm, FieldError, SubmitButton } from "@/components/forms";
import { CropEditor } from "../crop-editor";
import { publishBlockers } from "@/lib/products";
import {
  approveClaimsAction,
  attachLibraryImageAction,
  generateSkuAction,
  imageAction,
  markReviewedAction,
  saveBundleAction,
  saveVariantAction,
  setStatusAction,
  updateProductAction,
  uploadImagesAction,
} from "../actions";

const TYPE_LABEL: Record<string, string> = {
  COSMETIC: "Cosmetic / body care",
  HOUSEHOLD: "Household",
  TRADITIONAL_SPIRITUAL: "Traditional or spiritual use",
  INCENSE_FRAGRANCE: "Incense & fragrance",
  HERBAL_CONSUMABLE: "Herbal tea / supplement (consumed)",
  BUNDLE: "Bundle of other products",
  OTHER: "Other",
};

const centsToInput = (c: number | null | undefined) => (c == null ? "" : String(c / 100));

export default async function ProductEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireStaffPage("products.view", `/admin/products/${id}`);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const p = await db.query.products.findFirst({
    where: eq(schema.products.id, id),
    with: { variants: { orderBy: (v) => [asc(v.sortOrder), asc(v.createdAt)] }, images: { orderBy: (i) => asc(i.sortOrder), with: { asset: true } }, category: true },
  });
  if (!p) notFound();
  const canEdit = user.permissions.includes("products.edit");
  const canPublish = user.permissions.includes("products.publish");
  const canApprove = user.permissions.includes("products.approve_claims");
  const [cats, suppliers, blockers, balances, locations] = await Promise.all([
    db.select().from(schema.categories).orderBy(asc(schema.categories.sortOrder)),
    db.select({ id: schema.suppliers.id, name: schema.suppliers.name }).from(schema.suppliers).orderBy(asc(schema.suppliers.name)),
    publishBlockers(id),
    p.variants.length
      ? db.select().from(schema.inventoryBalances).where(inArray(schema.inventoryBalances.variantId, p.variants.map((v) => v.id)))
      : Promise.resolve([]),
    db.select().from(schema.locations),
  ]);
  const flags = checkClaims({ name: p.name, description: p.description, usage: p.usageInstructions });
  const usedAssetIds = p.images.map((i) => i.assetId);
  const library = await db
    .select()
    .from(schema.mediaAssets)
    .where(usedAssetIds.length ? notInArray(schema.mediaAssets.id, usedAssetIds) : sql`true`)
    .orderBy(sql`${schema.mediaAssets.createdAt} desc`)
    .limit(40);
  const bundleVariants = p.variants.filter((v) => v.isBundle);
  const componentOptions = bundleVariants.length
    ? await db
        .select({ id: schema.productVariants.id, name: schema.productVariants.name, product: schema.products.name })
        .from(schema.productVariants)
        .innerJoin(schema.products, eq(schema.products.id, schema.productVariants.productId))
        .where(sql`${schema.productVariants.isBundle} = false and ${schema.products.status} <> 'ARCHIVED'`)
        .orderBy(asc(schema.products.name))
    : [];
  const bundleRows = bundleVariants.length
    ? await db.select().from(schema.bundleItems).where(inArray(schema.bundleItems.bundleVariantId, bundleVariants.map((v) => v.id)))
    : [];

  const statusTone = p.status === "PUBLISHED" ? "ok" : p.status === "ARCHIVED" ? "neutral" : "plum";
  const scheduled = p.status === "PUBLISHED" && p.publishAt && p.publishAt > new Date();

  return (
    <>
      <p className="mb-2 text-sm">
        <Link className="link" href="/admin/products">Products</Link>
      </p>
      <PageHeader
        title={p.name}
        description={
          <span className="flex flex-wrap gap-1">
            <Badge tone={statusTone}>{scheduled ? `Scheduled for ${fmtDate(p.publishAt, true)}` : p.status === "PUBLISHED" ? "Published" : p.status === "ARCHIVED" ? "Archived" : "Draft"}</Badge>
            {p.needsReview ? <Badge tone="warn">Needs review</Badge> : <Badge tone="ok">Reviewed</Badge>}
            {flags.length ? <Badge tone={p.claimsApproved ? "ok" : "bad"}>{p.claimsApproved ? "Wording approved" : "Wording needs approval"}</Badge> : null}
          </span>
        }
        actions={p.status === "PUBLISHED" ? <Link className="btn-secondary" href={`/products/${p.slug}`} target="_blank">View in shop</Link> : null}
      />

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          {/* Details */}
          <section className="card p-5">
            <h2 className="mb-4 text-xl">Details</h2>
            <ActionForm action={updateProductAction} className="grid gap-4 sm:grid-cols-2">
              <input type="hidden" name="id" value={p.id} />
              <div className="sm:col-span-2">
                <Field label="Name" name="name" hint="Use the exact name on the label.">
                  <input className="input" id="name" name="name" defaultValue={p.name} required disabled={!canEdit} />
                </Field>
                <FieldError name="name" />
              </div>
              <Field label="Brand / maker" name="brand">
                <input className="input" id="brand" name="brand" defaultValue={p.brand ?? ""} disabled={!canEdit} />
              </Field>
              <Field label="Web address" name="slug" hint={`/products/${p.slug}`}>
                <input className="input" id="slug" name="slug" defaultValue={p.slug} disabled={!canEdit} />
              </Field>
              <Field label="Category" name="categoryId">
                <select className="input" id="categoryId" name="categoryId" defaultValue={p.categoryId ?? ""} disabled={!canEdit}>
                  <option value="">None</option>
                  {cats.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Product type" name="productType" hint="Decides which standard notice customers see.">
                <select className="input" id="productType" name="productType" defaultValue={p.productType} disabled={!canEdit}>
                  {Object.entries(TYPE_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </Field>
              <div className="sm:col-span-2">
                <Field label="Description" name="description" hint="Describe what it is, its scent, size and how it's packed. Avoid promising results — see the wording check.">
                  <textarea className="input min-h-[120px]" id="description" name="description" defaultValue={p.description ?? ""} disabled={!canEdit} />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="How to use" name="usageInstructions">
                  <textarea className="input min-h-[80px]" id="usageInstructions" name="usageInstructions" defaultValue={p.usageInstructions ?? ""} disabled={!canEdit} />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="Safety warnings" name="warnings" hint={STANDARD_DISCLAIMERS[p.productType] ? `Shown in addition to the standard notice: “${STANDARD_DISCLAIMERS[p.productType]}”` : undefined}>
                  <textarea className="input min-h-[60px]" id="warnings" name="warnings" defaultValue={p.warnings ?? ""} disabled={!canEdit} />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="Ingredients" name="ingredients">
                  <textarea className="input min-h-[60px]" id="ingredients" name="ingredients" defaultValue={p.ingredients ?? ""} disabled={!canEdit} />
                </Field>
                <label className="mt-2 flex items-center gap-2 text-sm">
                  <input type="checkbox" className="checkbox" name="ingredientsVerified" defaultChecked={p.ingredientsVerified} disabled={!canEdit} />
                  Ingredients checked against the label or supplier — show them in the shop
                </label>
              </div>
              <Field label="Tax category" name="taxCategory">
                <select className="input" id="taxCategory" name="taxCategory" defaultValue={p.taxCategory} disabled={!canEdit}>
                  <option value="STANDARD">Standard rate</option>
                  <option value="ZERO_RATED">Zero-rated</option>
                  <option value="EXEMPT">Exempt</option>
                </select>
              </Field>
              <Field label="Usual supplier" name="defaultSupplierId">
                <select className="input" id="defaultSupplierId" name="defaultSupplierId" defaultValue={p.defaultSupplierId ?? ""} disabled={!canEdit}>
                  <option value="">Not set</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </Field>
              <div className="sm:col-span-2">
                <Field label="Shipping restriction" name="shippingRestriction" hint="Shown at checkout, e.g. 'Collection only' or 'Not sent by courier'.">
                  <input className="input" id="shippingRestriction" name="shippingRestriction" defaultValue={p.shippingRestriction ?? ""} disabled={!canEdit} />
                </Field>
              </div>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input type="checkbox" className="checkbox" name="isFeatured" defaultChecked={p.isFeatured} disabled={!canEdit} /> Feature on the home page
              </label>
              <div className="rounded border border-line bg-ivory-200/40 p-4 sm:col-span-2">
                <p className="mb-3 text-sm font-semibold">Staff only — never shown to customers</p>
                <Field label="What still needs checking" name="reviewNotes">
                  <textarea className="input min-h-[80px]" id="reviewNotes" name="reviewNotes" defaultValue={p.reviewNotes ?? ""} disabled={!canEdit} />
                </Field>
                <div className="mt-3">
                  <Field label="What the label says" name="labelTranscript">
                    <textarea className="input min-h-[80px]" id="labelTranscript" name="labelTranscript" defaultValue={p.labelTranscript ?? ""} disabled={!canEdit} />
                  </Field>
                </div>
              </div>
              {canEdit ? (
                <div className="sm:col-span-2">
                  <SubmitButton>Save details</SubmitButton>
                </div>
              ) : null}
            </ActionForm>
          </section>

          {/* Variants */}
          <section className="card p-5">
            <h2 className="mb-1 text-xl">Sizes, prices and codes</h2>
            <p className="mb-4 text-sm text-ink-soft">Prices are in whole Kenyan shillings. Leave a price empty until it&apos;s confirmed — products without a price can&apos;t be sold.</p>
            <div className="space-y-3">
              {p.variants.map((v) => {
                const bal = balances.filter((b) => b.variantId === v.id);
                return (
                  <details key={v.id} className="rounded border border-line bg-white" open={p.variants.length === 1}>
                    <summary className="flex cursor-pointer flex-wrap items-center gap-3 px-4 py-3">
                      <span className="font-semibold">{v.name}</span>
                      <span className="text-sm text-ink-soft">{v.sku ?? "No SKU"}</span>
                      <span className="ml-auto">{v.priceCents != null ? <Money cents={v.priceCents} /> : <Badge tone="warn">Price not set</Badge>}</span>
                      {!v.isActive ? <Badge>Inactive</Badge> : null}
                    </summary>
                    <div className="border-t border-line px-4 py-4">
                      <ActionForm action={saveVariantAction} className="grid gap-3 sm:grid-cols-3">
                        <input type="hidden" name="productId" value={p.id} />
                        <input type="hidden" name="variantId" value={v.id} />
                        <VariantFields v={v} disabled={!canEdit} />
                        {canEdit ? (
                          <div className="sm:col-span-3">
                            <SubmitButton className="btn-primary btn-sm">Save variant</SubmitButton>
                          </div>
                        ) : null}
                      </ActionForm>
                      {canEdit && !v.sku ? (
                        <ActionForm action={generateSkuAction} className="mt-2">
                          <input type="hidden" name="variantId" value={v.id} />
                          <SubmitButton className="btn-ghost btn-sm">Generate a SKU</SubmitButton>
                        </ActionForm>
                      ) : null}
                      <div className="mt-4 text-sm">
                        <p className="font-semibold">Stock</p>
                        {v.isBundle ? (
                          <p className="text-ink-soft">Bundles use the stock of the items inside them.</p>
                        ) : bal.length ? (
                          <ul className="text-ink-soft">
                            {bal.map((b) => (
                              <li key={b.id}>
                                {locations.find((l) => l.id === b.locationId)?.name}: {b.onHand} on hand, {b.reserved} held for orders, {b.onHand - b.reserved} available
                                {b.quarantined ? `, ${b.quarantined} damaged/expired` : ""}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-ink-soft">No stock recorded yet.</p>
                        )}
                        {!v.isBundle ? (
                          <p className="mt-1">
                            <Link className="link" href={`/admin/inventory/adjust?variant=${v.id}`}>Record opening stock or adjust</Link> ·{" "}
                            <Link className="link" href={`/admin/inventory/movements?variant=${v.id}`}>Movement history</Link>
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </details>
                );
              })}
            </div>
            {canEdit ? (
              <details className="mt-4">
                <summary className="btn-secondary btn-sm cursor-pointer list-none">Add another size or variant</summary>
                <ActionForm action={saveVariantAction} className="mt-3 grid gap-3 rounded border border-line bg-white p-4 sm:grid-cols-3" resetOnSuccess>
                  <input type="hidden" name="productId" value={p.id} />
                  <VariantFields v={null} disabled={false} />
                  <div className="sm:col-span-3">
                    <SubmitButton className="btn-primary btn-sm">Add variant</SubmitButton>
                  </div>
                </ActionForm>
              </details>
            ) : null}
          </section>

          {/* Bundle */}
          {bundleVariants.map((bv) => {
            const rows = bundleRows.filter((r) => r.bundleVariantId === bv.id);
            const blanks = Math.max(2, 5 - rows.length);
            return (
              <section key={bv.id} className="card p-5">
                <h2 className="mb-1 text-xl">What&apos;s in “{bv.name}”</h2>
                <p className="mb-4 text-sm text-ink-soft">Selling the bundle takes stock from each item listed here.</p>
                <ActionForm action={saveBundleAction} className="space-y-2">
                  <input type="hidden" name="productId" value={p.id} />
                  <input type="hidden" name="bundleVariantId" value={bv.id} />
                  {[...rows, ...Array.from({ length: blanks }, () => null)].map((r, i) => (
                    <div key={i} className="flex gap-2">
                      <select className="input input-sm flex-1" name="componentVariantId" defaultValue={r?.componentVariantId ?? ""} disabled={!canEdit} aria-label="Item">
                        <option value="">—</option>
                        {componentOptions.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.product} · {o.name}
                          </option>
                        ))}
                      </select>
                      <input className="input input-sm w-20" name="componentQty" type="number" min={1} defaultValue={r?.qty ?? 1} disabled={!canEdit} aria-label="Quantity" />
                    </div>
                  ))}
                  {canEdit ? <SubmitButton className="btn-primary btn-sm">Save contents</SubmitButton> : null}
                </ActionForm>
              </section>
            );
          })}

          {/* Images */}
          <section className="card p-5">
            <h2 className="mb-1 text-xl">Photos</h2>
            <p className="mb-4 text-sm text-ink-soft">The first photo is the main one. Frame a product when a photo shows several items.</p>
            {p.images.length === 0 ? <Notice>No photos yet. Upload one or choose from the image library.</Notice> : null}
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {p.images.map((img, i) => (
                <li key={img.id} className="rounded border border-line bg-white p-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={mediaUrl(img.assetId, 480, imageCrop(img))} alt={img.alt ?? ""} className="aspect-square w-full rounded-sm bg-ivory-200 object-contain" loading="lazy" />
                  <p className="mt-2 text-[12px] text-ink-soft">
                    {i === 0 ? "Main photo · " : ""}
                    {img.asset.originalName ?? "Uploaded photo"}
                    {imageCrop(img) ? " · framed" : ""}
                  </p>
                  {canEdit ? (
                    <>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {i > 0 ? <ImageOp id={img.id} op="first" label="Make main" /> : null}
                        {i > 0 ? <ImageOp id={img.id} op="up" label="Move left" /> : null}
                        {i < p.images.length - 1 ? <ImageOp id={img.id} op="down" label="Move right" /> : null}
                        <ImageOp id={img.id} op="remove" label="Remove" confirm="Remove this photo from the product? It stays in the image library." />
                      </div>
                      <ActionForm action={imageAction} className="mt-2 flex gap-1">
                        <input type="hidden" name="imageId" value={img.id} />
                        <input type="hidden" name="op" value="alt" />
                        <input className="input input-sm flex-1" name="alt" defaultValue={img.alt ?? ""} placeholder="Describe the photo" aria-label="Photo description" />
                        <SubmitButton className="btn-secondary btn-sm">Save</SubmitButton>
                      </ActionForm>
                      <details className="mt-2">
                        <summary className="cursor-pointer text-sm text-plum">Frame this photo</summary>
                        <div className="mt-2">
                          <CropEditor imageId={img.id} src={mediaUrl(img.assetId, 960)} initial={imageCrop(img)} action={imageAction} />
                        </div>
                      </details>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
            {canEdit ? (
              <div className="mt-5 grid gap-4 lg:grid-cols-2">
                <ActionForm action={uploadImagesAction} className="rounded border border-dashed border-line p-4">
                  <input type="hidden" name="productId" value={p.id} />
                  <label className="field-label" htmlFor="files">Upload photos</label>
                  <input id="files" name="files" type="file" accept="image/jpeg,image/png,image/webp" multiple className="block w-full text-sm" />
                  <p className="field-hint">JPEG, PNG or WebP up to 8 MB. Location data in phone photos is removed.</p>
                  <div className="mt-2">
                    <SubmitButton className="btn-primary btn-sm" pendingText="Uploading…">Upload</SubmitButton>
                  </div>
                </ActionForm>
                <details className="rounded border border-line p-4">
                  <summary className="cursor-pointer font-semibold">Choose from the image library ({library.length})</summary>
                  <ul className="mt-3 grid grid-cols-3 gap-2">
                    {library.map((a) => (
                      <li key={a.id}>
                        <ActionForm action={attachLibraryImageAction}>
                          <input type="hidden" name="productId" value={p.id} />
                          <input type="hidden" name="assetId" value={a.id} />
                          <button className="block w-full" title={a.caption ?? a.originalName ?? ""}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={mediaUrl(a.id, 160)} alt={a.caption ?? "Library photo"} className="aspect-square w-full rounded-sm object-cover" loading="lazy" />
                          </button>
                        </ActionForm>
                      </li>
                    ))}
                  </ul>
                </details>
              </div>
            ) : null}
          </section>
        </div>

        {/* Side panel */}
        <aside className="space-y-6">
          <section className="card p-5">
            <h2 className="mb-3 text-lg">Ready to sell?</h2>
            {blockers.length ? (
              <ul className="list-disc space-y-1 pl-5 text-sm text-ink-soft">
                {blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            ) : (
              <Notice tone="ok">Everything needed to publish is in place.</Notice>
            )}
            {canEdit ? (
              <ActionForm action={markReviewedAction} className="mt-4">
                <input type="hidden" name="id" value={p.id} />
                <input type="hidden" name="reviewed" value={p.needsReview ? "1" : "0"} />
                <SubmitButton className="btn-secondary btn-sm w-full">{p.needsReview ? "Mark details as reviewed" : "Flag for review again"}</SubmitButton>
              </ActionForm>
            ) : null}
            {canPublish ? (
              <div className="mt-4 space-y-2 border-t border-line pt-4">
                {p.status !== "PUBLISHED" ? (
                  <ActionForm action={setStatusAction} className="space-y-2">
                    <input type="hidden" name="id" value={p.id} />
                    <input type="hidden" name="status" value="PUBLISHED" />
                    <label className="field-label" htmlFor="publishAt">Publish at (optional)</label>
                    <input className="input input-sm" type="datetime-local" id="publishAt" name="publishAt" />
                    <SubmitButton className="btn-primary w-full">Publish</SubmitButton>
                  </ActionForm>
                ) : (
                  <ActionForm action={setStatusAction}>
                    <input type="hidden" name="id" value={p.id} />
                    <input type="hidden" name="status" value="DRAFT" />
                    <SubmitButton className="btn-secondary w-full">Unpublish (move to draft)</SubmitButton>
                  </ActionForm>
                )}
                {p.status !== "ARCHIVED" ? (
                  <ActionForm action={setStatusAction} confirm="Archive this product? It disappears from the shop and POS but stays in past orders and reports.">
                    <input type="hidden" name="id" value={p.id} />
                    <input type="hidden" name="status" value="ARCHIVED" />
                    <SubmitButton className="btn-ghost w-full">Archive</SubmitButton>
                  </ActionForm>
                ) : (
                  <ActionForm action={setStatusAction}>
                    <input type="hidden" name="id" value={p.id} />
                    <input type="hidden" name="status" value="DRAFT" />
                    <SubmitButton className="btn-secondary w-full">Restore to draft</SubmitButton>
                  </ActionForm>
                )}
                <p className="text-[12px] text-ink-soft">Products are never deleted, so past orders and reports stay intact.</p>
              </div>
            ) : null}
          </section>

          <section className="card p-5">
            <h2 className="mb-2 text-lg">Wording check</h2>
            {flags.length === 0 ? (
              <p className="text-sm text-ink-soft">No medical, financial, relationship or supernatural promises found in the name, description or usage text.</p>
            ) : (
              <>
                <p className="mb-2 text-sm text-ink-soft">These phrases promise results. They need the owner&apos;s sign-off before the product can be published:</p>
                <ul className="mb-3 space-y-1 text-sm">
                  {flags.map((f, i) => (
                    <li key={i}>
                      <Badge tone="bad">{f.label}</Badge> “{f.match}” in {f.field}
                    </li>
                  ))}
                </ul>
                <p className="mb-3 text-[13px] text-ink-soft">
                  Herbal products sold with health claims may need Pharmacy and Poisons Board registration. Consider describing the product
                  factually instead. This check is a safeguard, not legal advice.
                </p>
                {p.claimsApproved ? (
                  <Notice tone="ok">Approved: {p.claimsApprovalNote}</Notice>
                ) : canApprove ? (
                  <ActionForm action={approveClaimsAction} className="space-y-2">
                    <input type="hidden" name="id" value={p.id} />
                    <label className="field-label" htmlFor="note">Reason for approving</label>
                    <textarea className="input min-h-[70px]" id="note" name="note" placeholder="e.g. Name is the manufacturer's registered product name; description makes no claims." />
                    <FieldError name="note" />
                    <SubmitButton className="btn-secondary btn-sm">Approve this wording</SubmitButton>
                  </ActionForm>
                ) : (
                  <p className="text-sm text-ink-soft">Ask the owner to review it.</p>
                )}
              </>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}

function ImageOp({ id, op, label, confirm }: { id: string; op: string; label: string; confirm?: string }) {
  return (
    <ActionForm action={imageAction} confirm={confirm}>
      <input type="hidden" name="imageId" value={id} />
      <input type="hidden" name="op" value={op} />
      <SubmitButton className="btn-ghost btn-sm">{label}</SubmitButton>
    </ActionForm>
  );
}

function VariantFields({ v, disabled }: { v: typeof schema.productVariants.$inferSelect | null; disabled: boolean }) {
  return (
    <>
      <Field label="Size / variant name" name="name">
        <input className="input input-sm" name="name" defaultValue={v?.name ?? ""} placeholder="e.g. 100 ml" disabled={disabled} />
      </Field>
      <Field label="SKU" name="sku">
        <input className="input input-sm" name="sku" defaultValue={v?.sku ?? ""} disabled={disabled} />
      </Field>
      <Field label="Barcode" name="barcode">
        <input className="input input-sm" name="barcode" defaultValue={v?.barcode ?? ""} inputMode="numeric" disabled={disabled} />
      </Field>
      <Field label="Price (KES)" name="price">
        <input className="input input-sm" name="price" defaultValue={centsToInput(v?.priceCents)} inputMode="decimal" disabled={disabled} />
        <FieldError name="price" />
      </Field>
      <Field label="Was price (KES)" name="compareAt" hint="Only for a genuine reduction.">
        <input className="input input-sm" name="compareAt" defaultValue={centsToInput(v?.compareAtCents)} inputMode="decimal" disabled={disabled} />
        <FieldError name="compareAt" />
      </Field>
      <Field label="Average cost (KES)" name="cost" hint="Calculated from goods received.">
        <input className="input input-sm" value={v?.avgCostCents != null ? (v.avgCostCents / 100).toFixed(2) : "Not known yet"} readOnly disabled />
      </Field>
      <Field label="Wholesale price (KES)" name="wholesalePrice">
        <input className="input input-sm" name="wholesalePrice" defaultValue={centsToInput(v?.wholesalePriceCents)} inputMode="decimal" disabled={disabled} />
      </Field>
      <Field label="Wholesale from qty" name="wholesaleMinQty">
        <input className="input input-sm" name="wholesaleMinQty" type="number" min={1} defaultValue={v?.wholesaleMinQty ?? 1} disabled={disabled} />
      </Field>
      <Field label="Weight (grams)" name="weightGrams">
        <input className="input input-sm" name="weightGrams" type="number" min={0} defaultValue={v?.weightGrams ?? ""} disabled={disabled} />
      </Field>
      <Field label="Reorder when at or below" name="reorderLevel">
        <input className="input input-sm" name="reorderLevel" type="number" min={0} defaultValue={v?.reorderLevel ?? 0} disabled={disabled} />
      </Field>
      <Field label="Usual reorder quantity" name="reorderQty">
        <input className="input input-sm" name="reorderQty" type="number" min={0} defaultValue={v?.reorderQty ?? 0} disabled={disabled} />
      </Field>
      <div className="flex flex-col justify-end gap-2 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" className="checkbox" name="trackBatches" defaultChecked={v?.trackBatches ?? false} disabled={disabled} /> Track batches & expiry
        </label>
        <label className="flex items-center gap-2">
          <input type="hidden" name="isActive" value="false" />
          <input type="checkbox" className="checkbox" name="isActive" value="on" defaultChecked={v?.isActive ?? true} disabled={disabled} /> Available to sell
        </label>
      </div>
    </>
  );
}
