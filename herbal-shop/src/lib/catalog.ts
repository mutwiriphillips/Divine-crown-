import { and, asc, desc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { getDefaultLocationId } from "@/lib/inventory";

/** A product is visible in the shop when published, past its publish time, not archived, in an active category, and has a priced active variant. */
export function visibleProduct(): SQL {
  const p = schema.products;
  return and(
    eq(p.status, "PUBLISHED"),
    or(isNull(p.publishAt), sql`${p.publishAt} <= now()`),
    isNull(p.archivedAt),
    sql`(${p.categoryId} is null or exists (select 1 from categories c where c.id = ${p.categoryId} and c.is_active))`,
    sql`exists (select 1 from product_variants v where v.product_id = ${p.id} and v.is_active and v.price_cents is not null)`,
  )!;
}

export type CardProduct = {
  id: string;
  name: string;
  slug: string;
  brand: string | null;
  categoryName: string | null;
  minPriceCents: number;
  compareAtCents: number | null;
  imageAssetId: string | null;
  crop: { x: number; y: number; w: number; h: number } | null;
  available: number;
  rating: number | null;
  ratingCount: number;
};

type Sort = "relevance" | "price_asc" | "price_desc" | "newest" | "popular";

async function toCards(ids: string[]): Promise<CardProduct[]> {
  if (!ids.length) return [];
  const loc = await getDefaultLocationId();
  const r = await db.execute<{
    id: string; name: string; slug: string; brand: string | null; category_name: string | null;
    min_price: number; compare_at: number | null; asset_id: string | null;
    crop_x: number | null; crop_y: number | null; crop_w: number | null; crop_h: number | null;
    available: number; rating: string | null; rating_count: number;
  }>(sql`
    select p.id, p.name, p.slug, p.brand, c.name as category_name,
      (select min(v.price_cents) from product_variants v where v.product_id = p.id and v.is_active and v.price_cents is not null)::int as min_price,
      (select v.compare_at_cents from product_variants v where v.product_id = p.id and v.is_active and v.price_cents is not null order by v.price_cents limit 1)::int as compare_at,
      i.asset_id, i.crop_x, i.crop_y, i.crop_w, i.crop_h,
      coalesce((
        select sum(case when v.is_bundle then (
            select coalesce(min(floor((coalesce(b2.on_hand,0) - coalesce(b2.reserved,0)) / bi.qty)),0)
              from bundle_items bi left join inventory_balances b2 on b2.variant_id = bi.component_variant_id and b2.location_id = ${loc}
             where bi.bundle_variant_id = v.id)
          else (select coalesce(sum(b.on_hand - b.reserved),0) from inventory_balances b where b.variant_id = v.id and b.location_id = ${loc}) end)
        from product_variants v where v.product_id = p.id and v.is_active and v.price_cents is not null),0)::int as available,
      (select avg(rating)::numeric(3,2) from reviews rv where rv.product_id = p.id and rv.status = 'APPROVED' and rv.type = 'PRODUCT') as rating,
      (select count(*)::int from reviews rv where rv.product_id = p.id and rv.status = 'APPROVED' and rv.type = 'PRODUCT') as rating_count
    from products p
    left join categories c on c.id = p.category_id
    left join lateral (select * from product_images pi where pi.product_id = p.id order by pi.sort_order limit 1) i on true
    where p.id in (${sql.join(ids.map((x) => sql`${x}::uuid`), sql`, `)})
  `);
  const byId = new Map(
    r.rows.map((x) => [
      x.id,
      {
        id: x.id,
        name: x.name,
        slug: x.slug,
        brand: x.brand,
        categoryName: x.category_name,
        minPriceCents: Number(x.min_price),
        compareAtCents: x.compare_at != null ? Number(x.compare_at) : null,
        imageAssetId: x.asset_id,
        crop: x.crop_w && x.crop_h ? { x: x.crop_x ?? 0, y: x.crop_y ?? 0, w: x.crop_w, h: x.crop_h } : null,
        available: Number(x.available),
        rating: x.rating != null ? Number(x.rating) : null,
        ratingCount: Number(x.rating_count),
      } satisfies CardProduct,
    ]),
  );
  return ids.map((id) => byId.get(id)).filter((x): x is CardProduct => !!x);
}

export async function searchProducts(opts: {
  q?: string;
  categorySlug?: string;
  sort?: Sort;
  page?: number;
  pageSize?: number;
  inStock?: boolean;
  minCents?: number | null;
  maxCents?: number | null;
}) {
  const p = schema.products;
  const pageSize = opts.pageSize ?? 24;
  const page = Math.max(1, opts.page ?? 1);
  const filters: SQL[] = [visibleProduct()];
  const q = opts.q?.trim();
  if (q) {
    filters.push(sql`(
      to_tsvector('simple', coalesce(${p.name},'') || ' ' || coalesce(${p.brand},'')) @@ plainto_tsquery('simple', ${q})
      or ${p.name} ilike ${`%${q}%`} or ${p.brand} ilike ${`%${q}%`} or ${p.description} ilike ${`%${q}%`}
      or exists (select 1 from product_variants v where v.product_id = ${p.id} and (v.sku ilike ${q} or v.barcode = ${q})))`);
  }
  if (opts.categorySlug) {
    filters.push(sql`${p.categoryId} in (
      with recursive tree as (select id from categories where slug = ${opts.categorySlug} union all select c.id from categories c join tree t on c.parent_id = t.id)
      select id from tree)`);
  }
  const minPrice = sql`(select min(v.price_cents) from product_variants v where v.product_id = ${p.id} and v.is_active and v.price_cents is not null)`;
  if (opts.minCents != null) filters.push(sql`${minPrice} >= ${opts.minCents}`);
  if (opts.maxCents != null) filters.push(sql`${minPrice} <= ${opts.maxCents}`);
  if (opts.inStock) {
    filters.push(sql`exists (select 1 from product_variants v join inventory_balances b on b.variant_id = v.id
       where v.product_id = ${p.id} and v.is_active and b.on_hand - b.reserved > 0)
       or exists (select 1 from product_variants v where v.product_id = ${p.id} and v.is_bundle)`);
  }
  const sold = sql`(select coalesce(sum(oi.qty),0) from order_items oi join product_variants v on v.id = oi.variant_id join orders o on o.id = oi.order_id
                    where v.product_id = ${p.id} and o.status not in ('CANCELLED','AWAITING_PAYMENT','PENDING') and o.placed_at > now() - interval '180 days')`;
  const order =
    opts.sort === "price_asc"
      ? [sql`${minPrice} asc`, asc(p.name)]
      : opts.sort === "price_desc"
        ? [sql`${minPrice} desc`, asc(p.name)]
        : opts.sort === "newest"
          ? [desc(p.createdAt)]
          : opts.sort === "popular"
            ? [sql`${sold} desc`, asc(p.name)]
            : q
              ? [sql`(${p.name} ilike ${`${q}%`}) desc`, sql`${sold} desc`, asc(p.name)]
              : [desc(p.isFeatured), sql`${sold} desc`, asc(p.name)];
  const where = and(...filters);
  const [rows, count] = await Promise.all([
    db.select({ id: p.id }).from(p).where(where).orderBy(...order).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ n: sql<number>`count(*)::int` }).from(p).where(where),
  ]);
  return { items: await toCards(rows.map((r) => r.id)), total: Number(count[0].n), page, pageSize };
}

export async function featuredProducts(limit = 8) {
  const rows = await db.select({ id: schema.products.id }).from(schema.products).where(and(visibleProduct(), eq(schema.products.isFeatured, true))).orderBy(asc(schema.products.name)).limit(limit);
  return toCards(rows.map((r) => r.id));
}

export async function newArrivals(limit = 8) {
  const rows = await db.select({ id: schema.products.id }).from(schema.products).where(visibleProduct()).orderBy(desc(schema.products.createdAt)).limit(limit);
  return toCards(rows.map((r) => r.id));
}

/** Bestsellers from real completed sales in the last 90 days. Returns [] when there are no sales yet. */
export async function bestsellers(limit = 8) {
  const r = await db.execute<{ product_id: string; units: number }>(sql`
    select v.product_id, sum(oi.qty - oi.qty_refunded)::int as units
      from order_items oi join orders o on o.id = oi.order_id join product_variants v on v.id = oi.variant_id
     where o.status not in ('CANCELLED','AWAITING_PAYMENT','PENDING','REFUNDED') and o.placed_at > now() - interval '90 days' and o.is_demo = false
     group by v.product_id having sum(oi.qty - oi.qty_refunded) > 0 order by units desc limit ${limit * 2}`);
  const ids = r.rows.map((x) => x.product_id);
  if (!ids.length) return [];
  const visible = await db.select({ id: schema.products.id }).from(schema.products).where(and(visibleProduct(), inArray(schema.products.id, ids)));
  const vis = new Set(visible.map((v) => v.id));
  return toCards(ids.filter((id) => vis.has(id)).slice(0, limit));
}

export async function relatedProducts(productId: string, categoryId: string | null, limit = 4) {
  if (!categoryId) return [];
  const rows = await db
    .select({ id: schema.products.id })
    .from(schema.products)
    .where(and(visibleProduct(), eq(schema.products.categoryId, categoryId), sql`${schema.products.id} <> ${productId}`))
    .orderBy(sql`random()`)
    .limit(limit);
  return toCards(rows.map((r) => r.id));
}

export async function categoriesWithCounts() {
  const r = await db.execute<{ id: string; name: string; slug: string; description: string | null; parent_id: string | null; n: number }>(sql`
    select c.id, c.name, c.slug, c.description, c.parent_id,
      (select count(*)::int from products where products.category_id = c.id and ${visibleProduct()}) as n
      from categories c where c.is_active order by c.sort_order, c.name`);
  return r.rows.map((c) => ({ id: c.id, name: c.name, slug: c.slug, description: c.description, parentId: c.parent_id, count: Number(c.n) }));
}

export async function getVisibleProduct(slug: string) {
  const p = await db.query.products.findFirst({
    where: and(eq(schema.products.slug, slug), visibleProduct()),
    with: {
      category: true,
      variants: { where: (v, { and, eq, isNotNull }) => and(eq(v.isActive, true), isNotNull(v.priceCents)), orderBy: (v) => [asc(v.sortOrder), asc(v.priceCents)] },
      images: { orderBy: (i) => asc(i.sortOrder) },
    },
  });
  return p ?? null;
}

export async function approvedReviews(productId: string) {
  return db.query.reviews.findMany({
    where: and(eq(schema.reviews.productId, productId), eq(schema.reviews.status, "APPROVED"), eq(schema.reviews.type, "PRODUCT")),
    orderBy: (r) => desc(r.createdAt),
    limit: 50,
  });
}

export async function homepageReviews(limit = 6) {
  return db.query.reviews.findMany({
    where: and(eq(schema.reviews.status, "APPROVED"), sql`${schema.reviews.body} is not null and length(${schema.reviews.body}) > 20`, sql`${schema.reviews.rating} >= 4`),
    orderBy: (r) => desc(r.createdAt),
    limit,
    with: { product: { columns: { name: true, slug: true } } },
  });
}
