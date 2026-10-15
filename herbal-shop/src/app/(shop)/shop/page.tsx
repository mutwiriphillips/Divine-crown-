import Link from "next/link";
import { categoriesWithCounts, searchProducts } from "@/lib/catalog";
import { parseKESToCents } from "@/lib/money";
import { ProductGrid } from "@/components/shop/product-card";
import { Pagination } from "@/components/ui";

export const metadata = { title: "Shop" };

const SORTS = [
  ["relevance", "Recommended"],
  ["popular", "Most popular"],
  ["newest", "Newest"],
  ["price_asc", "Price: low to high"],
  ["price_desc", "Price: high to low"],
] as const;

function safeCents(v?: string) {
  try {
    return v ? parseKESToCents(v) : null;
  } catch {
    return null;
  }
}

export default async function ShopPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const cats = await categoriesWithCounts();
  const active = cats.find((c) => c.slug === sp.category);
  const sort = (SORTS.find(([k]) => k === sp.sort)?.[0] ?? "relevance") as (typeof SORTS)[number][0];
  const res = await searchProducts({
    q: sp.q,
    categorySlug: active?.slug,
    sort,
    page: Number(sp.page ?? 1),
    inStock: sp.stock === "1",
    minCents: safeCents(sp.min),
    maxCents: safeCents(sp.max),
  });
  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `/shop?${p.toString()}`;
  };
  const title = sp.q ? `Results for “${sp.q}”` : active ? active.name : "All products";

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-4xl">{title}</h1>
      {active?.description ? <p className="mt-2 max-w-prose text-ink-soft">{active.description}</p> : null}
      <div className="mt-6 grid gap-8 md:grid-cols-[220px_1fr]">
        <aside>
          <form className="space-y-5" aria-label="Filter products">
            {sp.q ? <input type="hidden" name="q" value={sp.q} /> : null}
            <input type="hidden" name="sort" value={sort} />
            <fieldset>
              <legend className="mb-2 font-semibold">Category</legend>
              <ul className="space-y-1 text-[15px]">
                <li>
                  <Link className={!active ? "font-semibold text-plum" : "hover:text-plum"} href={qs({ category: undefined, page: undefined })}>
                    All
                  </Link>
                </li>
                {cats.filter((c) => c.count > 0).map((c) => (
                  <li key={c.id}>
                    <Link className={active?.id === c.id ? "font-semibold text-plum" : "hover:text-plum"} href={qs({ category: c.slug, page: undefined })}>
                      {c.name} <span className="text-ink-faint">({c.count})</span>
                    </Link>
                  </li>
                ))}
              </ul>
              {active ? <input type="hidden" name="category" value={active.slug} /> : null}
            </fieldset>
            <fieldset>
              <legend className="mb-2 font-semibold">Price (KES)</legend>
              <div className="flex items-center gap-2">
                <input className="input input-sm" name="min" inputMode="numeric" placeholder="Min" defaultValue={sp.min} aria-label="Minimum price" />
                <span aria-hidden="true">–</span>
                <input className="input input-sm" name="max" inputMode="numeric" placeholder="Max" defaultValue={sp.max} aria-label="Maximum price" />
              </div>
            </fieldset>
            <label className="flex items-center gap-2 text-[15px]">
              <input type="checkbox" className="checkbox" name="stock" value="1" defaultChecked={sp.stock === "1"} /> In stock only
            </label>
            <button className="btn-secondary btn-sm w-full">Apply filters</button>
          </form>
        </aside>
        <div>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <p className="text-ink-soft">{res.total} {res.total === 1 ? "product" : "products"}</p>
            <form className="flex items-center gap-2 text-sm">
              {Object.entries(sp).filter(([k, v]) => v && k !== "sort" && k !== "page").map(([k, v]) => (
                <input key={k} type="hidden" name={k} value={v} />
              ))}
              <label htmlFor="sort">Sort</label>
              <select id="sort" name="sort" defaultValue={sort} className="input input-sm w-auto">
                {SORTS.map(([k, l]) => (
                  <option key={k} value={k}>{l}</option>
                ))}
              </select>
              <button className="btn-secondary btn-sm">Go</button>
            </form>
          </div>
          {res.items.length ? (
            <ProductGrid items={res.items} />
          ) : (
            <div className="card px-6 py-12 text-center">
              <p className="font-serif text-xl text-plum">Nothing matches that yet</p>
              <p className="mt-2 text-ink-soft">Try fewer filters, or <Link className="link" href="/support">ask us</Link> — we may have it in the shop.</p>
            </div>
          )}
          <Pagination page={res.page} pageSize={res.pageSize} total={res.total} hrefFor={(n) => qs({ page: String(n) })} />
        </div>
      </div>
    </div>
  );
}
