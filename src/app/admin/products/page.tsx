import Link from "next/link";
import { and, asc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireStaffPage } from "@/lib/auth/server";
import { imageCrop, mediaUrl } from "@/lib/media";
import { Badge, EmptyState, Money, PageHeader, Pagination } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { bulkProductsAction } from "./actions";

export const metadata = { title: "Products" };
const PAGE = 30;

export default async function ProductsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireStaffPage("products.view", "/admin/products");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const q = (sp.q ?? "").trim();
  const filters: SQL[] = [];
  if (sp.status) filters.push(eq(schema.products.status, sp.status as "DRAFT"));
  else filters.push(sql`${schema.products.status} <> 'ARCHIVED'`);
  if (sp.category) filters.push(eq(schema.products.categoryId, sp.category));
  if (sp.review === "1") filters.push(eq(schema.products.needsReview, true));
  if (q) {
    const like = `%${q}%`;
    filters.push(
      or(
        ilike(schema.products.name, like),
        ilike(schema.products.brand, like),
        sql`exists (select 1 from product_variants v where v.product_id = ${schema.products.id} and (v.sku ilike ${like} or v.barcode = ${q}))`,
      )!,
    );
  }
  const where = and(...filters);
  const [rows, countRes, cats] = await Promise.all([
    db.query.products.findMany({
      where,
      orderBy: [asc(schema.products.name)],
      limit: PAGE,
      offset: (page - 1) * PAGE,
      with: { category: true, variants: true, images: { orderBy: (i) => asc(i.sortOrder), limit: 1 } },
    }),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.products).where(where),
    db.select().from(schema.categories).orderBy(asc(schema.categories.sortOrder)),
  ]);
  const variantIds = rows.flatMap((r) => r.variants.map((v) => v.id));
  const stock = variantIds.length
    ? await db
        .select({ variantId: schema.inventoryBalances.variantId, avail: sql<number>`sum(on_hand - reserved)::int` })
        .from(schema.inventoryBalances)
        .where(inArray(schema.inventoryBalances.variantId, variantIds))
        .groupBy(schema.inventoryBalances.variantId)
    : [];
  const stockMap = new Map(stock.map((s) => [s.variantId, Number(s.avail)]));
  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `/admin/products?${p.toString()}`;
  };
  const canEdit = user.permissions.includes("products.edit");

  return (
    <>
      <PageHeader
        title="Products"
        description="Seeded products start as drafts that need review. Publish a product once its name, price and wording are checked."
        actions={
          canEdit ? (
            <>
              <Link className="btn-secondary" href="/admin/products/import">Import / export CSV</Link>
              <Link className="btn-primary" href="/admin/products/new">Add product</Link>
            </>
          ) : null
        }
      />
      <form className="mb-4 flex flex-wrap items-end gap-2" role="search">
        <div className="min-w-[220px] flex-1">
          <label className="field-label" htmlFor="q">Search</label>
          <input className="input input-sm" id="q" name="q" defaultValue={q} placeholder="Name, brand, SKU or barcode" />
        </div>
        <div>
          <label className="field-label" htmlFor="status">Status</label>
          <select className="input input-sm" id="status" name="status" defaultValue={sp.status ?? ""}>
            <option value="">Active (not archived)</option>
            <option value="DRAFT">Draft</option>
            <option value="PUBLISHED">Published</option>
            <option value="ARCHIVED">Archived</option>
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="category">Category</label>
          <select className="input input-sm" id="category" name="category" defaultValue={sp.category ?? ""}>
            <option value="">All</option>
            {cats.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <label className="flex min-h-[36px] items-center gap-2 text-sm">
          <input type="checkbox" className="checkbox" name="review" value="1" defaultChecked={sp.review === "1"} /> Needs review
        </label>
        <button className="btn-secondary btn-sm">Filter</button>
      </form>

      {rows.length === 0 ? (
        <EmptyState title="No products match" action={<Link className="btn-secondary" href="/admin/products">Clear filters</Link>}>
          Try a different search, or add a product.
        </EmptyState>
      ) : (
        <ActionForm action={bulkProductsAction}>
          {canEdit ? (
            <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-ink-soft">With selected:</span>
              <select name="op" className="input input-sm w-auto" defaultValue="">
                <option value="" disabled>Choose…</option>
                <option value="publish">Publish</option>
                <option value="draft">Move to draft</option>
                <option value="archive">Archive</option>
                <option value="feature">Mark featured</option>
                <option value="unfeature">Remove featured</option>
                <option value="category">Move to category…</option>
              </select>
              <select name="categoryId" className="input input-sm w-auto" defaultValue="">
                <option value="">(category for “move”)</option>
                {cats.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <SubmitButton className="btn-secondary btn-sm">Apply</SubmitButton>
            </div>
          ) : null}
          <div className="card overflow-x-auto">
            <table className="table [&_td]:align-middle">
              <thead>
                <tr>
                  {canEdit ? <th className="w-8"><span className="sr-only">Select</span></th> : null}
                  <th>Product</th>
                  <th>Category</th>
                  <th>Status</th>
                  <th className="text-right">Price</th>
                  <th className="text-right">Available</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const img = p.images[0];
                  const prices = p.variants.filter((v) => v.priceCents != null).map((v) => v.priceCents!);
                  const avail = p.variants.reduce((a, v) => a + (stockMap.get(v.id) ?? 0), 0);
                  const low = p.variants.some((v) => v.reorderLevel > 0 && (stockMap.get(v.id) ?? 0) <= v.reorderLevel);
                  return (
                    <tr key={p.id}>
                      {canEdit ? (
                        <td>
                          <input type="checkbox" className="checkbox" name="ids" value={p.id} aria-label={`Select ${p.name}`} />
                        </td>
                      ) : null}
                      <td>
                        <Link href={`/admin/products/${p.id}`} className="flex items-center gap-3">
                          {img ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={mediaUrl(img.assetId, 160, imageCrop(img))} alt="" className="h-12 w-12 rounded-sm bg-ivory-200 object-cover" loading="lazy" />
                          ) : (
                            <span className="grid h-12 w-12 place-items-center rounded-sm bg-ivory-200 text-[11px] text-ink-faint">No photo</span>
                          )}
                          <span>
                            <span className="font-semibold text-plum">{p.name}</span>
                            {p.brand ? <span className="block text-[13px] text-ink-soft">{p.brand}</span> : null}
                          </span>
                        </Link>
                      </td>
                      <td>{p.category?.name ?? <span className="text-ink-faint">None</span>}</td>
                      <td className="space-x-1 whitespace-nowrap">
                        <Badge tone={p.status === "PUBLISHED" ? "ok" : p.status === "ARCHIVED" ? "neutral" : "plum"}>{p.status === "PUBLISHED" ? "Published" : p.status === "ARCHIVED" ? "Archived" : "Draft"}</Badge>
                        {p.needsReview ? <Badge tone="warn">Needs review</Badge> : null}
                        {p.isFeatured ? <Badge tone="clay">Featured</Badge> : null}
                      </td>
                      <td className="whitespace-nowrap text-right">
                        {prices.length ? (
                          <Money cents={Math.min(...prices)} />
                        ) : (
                          <span className="text-warn">Not set</span>
                        )}
                      </td>
                      <td className={`text-right tabular-nums ${low ? "font-semibold text-bad" : ""}`}>{avail}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </ActionForm>
      )}
      <Pagination page={page} pageSize={PAGE} total={countRes[0].n} hrefFor={(n) => qs({ page: String(n) })} />
    </>
  );
}
