import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireStaffPage } from "@/lib/auth/server";
import { mediaUrl } from "@/lib/media";
import { ActionForm, SubmitButton } from "@/components/forms";
import { PageHeader } from "@/components/ui";
import { assetCaptionAction, uploadLibraryAction } from "../products/actions";

export const metadata = { title: "Image library" };

export default async function MediaPage() {
  await requireStaffPage("products.edit", "/admin/media");
  const assets = await db
    .select({
      a: schema.mediaAssets,
      used: sql<string[]>`coalesce(array_agg(${schema.products.name}) filter (where ${schema.products.id} is not null), '{}')`,
      productIds: sql<string[]>`coalesce(array_agg(${schema.products.id}::text) filter (where ${schema.products.id} is not null), '{}')`,
    })
    .from(schema.mediaAssets)
    .leftJoin(schema.productImages, eq(schema.productImages.assetId, schema.mediaAssets.id))
    .leftJoin(schema.products, eq(schema.products.id, schema.productImages.productId))
    .groupBy(schema.mediaAssets.id)
    .orderBy(desc(schema.mediaAssets.createdAt));
  return (
    <>
      <PageHeader title="Image library" description="Every photo uploaded to the shop. Attach photos to products from each product's page. Originals are kept, so you can re-frame them any time." />
      <ActionForm action={uploadLibraryAction} className="card mb-6 flex flex-wrap items-end gap-3 p-4">
        <div>
          <label className="field-label" htmlFor="files">Add photos</label>
          <input id="files" name="files" type="file" accept="image/jpeg,image/png,image/webp" multiple className="text-sm" />
        </div>
        <SubmitButton className="btn-primary btn-sm" pendingText="Uploading…">Upload</SubmitButton>
      </ActionForm>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {assets.map(({ a, used, productIds }) => (
          <li key={a.id} className="card p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={mediaUrl(a.id, 480)} alt={a.caption ?? a.originalName ?? "Photo"} className="aspect-square w-full rounded-sm bg-ivory-200 object-contain" loading="lazy" />
            <p className="mt-2 text-[12px] text-ink-soft">
              {a.originalName} · {a.width}×{a.height}
            </p>
            {a.sourceNote ? <p className="text-[12px] text-ink-soft">{a.sourceNote}</p> : null}
            <p className="mt-1 text-sm">
              {used.length ? (
                <>Used on: {used.map((n, i) => (
                  <Link key={i} className="link mr-1" href={`/admin/products/${productIds[i]}`}>{n}</Link>
                ))}</>
              ) : (
                <span className="text-warn">Not used on any product</span>
              )}
            </p>
            <ActionForm action={assetCaptionAction} className="mt-2 flex gap-1">
              <input type="hidden" name="assetId" value={a.id} />
              <input className="input input-sm flex-1" name="caption" defaultValue={a.caption ?? ""} placeholder="Caption (staff)" aria-label="Caption" />
              <SubmitButton className="btn-secondary btn-sm">Save</SubmitButton>
            </ActionForm>
          </li>
        ))}
      </ul>
    </>
  );
}
