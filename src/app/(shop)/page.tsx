import { whatsappUrl } from "@/lib/text";
import Link from "next/link";
import { and, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { bestsellers, categoriesWithCounts, featuredProducts, homepageReviews, newArrivals, visibleProduct } from "@/lib/catalog";
import { imageCrop, mediaUrl } from "@/lib/media";
import { formatKES } from "@/lib/money";
import { getAllSettings } from "@/lib/settings";
import { ProductGrid } from "@/components/shop/product-card";
import { Stars } from "@/components/shop/stars";
import { ActionForm, SubmitButton } from "@/components/forms";
import { newsletterAction } from "./actions";

export default async function HomePage() {
  const { business } = await getAllSettings();
  const now = new Date();
  const [featured, best, fresh, cats, reviews, banners, promos] = await Promise.all([
    featuredProducts(8),
    bestsellers(4),
    newArrivals(8),
    categoriesWithCounts(),
    homepageReviews(3),
    db.query.banners.findMany({
      where: and(eq(schema.banners.isActive, true), eq(schema.banners.placement, "home"), or(isNull(schema.banners.startsAt), lte(schema.banners.startsAt, now)), or(isNull(schema.banners.endsAt), gte(schema.banners.endsAt, now))),
      orderBy: (b) => b.sortOrder,
    }),
    db.query.promotions.findMany({
      where: and(eq(schema.promotions.isActive, true), isNull(schema.promotions.customerId), or(isNull(schema.promotions.startsAt), lte(schema.promotions.startsAt, now)), or(isNull(schema.promotions.endsAt), gte(schema.promotions.endsAt, now))),
      limit: 3,
    }),
  ]);

  // Hero photos: chosen in Settings, otherwise the main photos of shop products.
  let heroImages = business.hero.imageAssetIds.slice(0, 3).map((id) => ({ assetId: id, crop: null as ReturnType<typeof imageCrop>, alt: "" }));
  if (heroImages.length < 3) {
    const r = await db
      .select({ img: schema.productImages, name: schema.products.name })
      .from(schema.productImages)
      .innerJoin(schema.products, eq(schema.products.id, schema.productImages.productId))
      .where(and(visibleProduct(), eq(schema.productImages.sortOrder, 0)))
      .orderBy(sql`${schema.products.isFeatured} desc, random()`)
      .limit(3);
    heroImages = r.map((x) => ({ assetId: x.img.assetId, crop: imageCrop(x.img), alt: x.name }));
  }
  const catsWithProducts = cats.filter((c) => c.count > 0);
  const wa = whatsappUrl(business.whatsapp, `Hello ${business.name}, I would like to place an order.`);
  const nothingYet = !featured.length && !fresh.length;
  const usablePromos = promos.filter((p) => !p.usageLimit || p.usageCount < p.usageLimit);

  return (
    <>
      {/* Hero */}
      <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-12 pt-10 md:grid-cols-[1.05fr_1fr] md:pt-16">
        <div>
          <h1 className="text-[40px] leading-[1.05] sm:text-[52px] lg:text-[60px]">{business.hero.headline}</h1>
          {business.hero.intro ? <p className="mt-5 max-w-[46ch] text-lg text-ink-soft">{business.hero.intro}</p> : null}
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/shop" className="btn-primary px-6">Shop all products</Link>
            {wa ? (
              <a href={wa} className="btn-secondary" target="_blank" rel="noopener">
                Order on WhatsApp
              </a>
            ) : null}
          </div>
        </div>
        {heroImages.length ? (
          <div className={`grid gap-3 ${heroImages.length >= 3 ? "grid-cols-[1.25fr_1fr] grid-rows-2" : "grid-cols-2"}`} aria-hidden="true">
            {heroImages.map((im, i) => (
              <div key={im.assetId} className={`overflow-hidden rounded-sm bg-ivory-200 ${heroImages.length >= 3 && i === 0 ? "row-span-2 aspect-[3/4] sm:aspect-auto" : "aspect-square"}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={mediaUrl(im.assetId, i === 0 ? 960 : 640, im.crop)} alt="" className="h-full w-full object-cover" loading="eager" />
              </div>
            ))}
          </div>
        ) : null}
      </section>

      {banners.length ? (
        <section className="mx-auto max-w-6xl px-4">
          {banners.map((b) => (
            <div key={b.id} className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-sm border-l-4 border-clay bg-clay-100 px-5 py-4">
              <div>
                <p className="font-serif text-xl text-clay-700">{b.title}</p>
                {b.body ? <p className="text-ink-soft">{b.body}</p> : null}
              </div>
              {b.linkUrl ? <Link className="btn-clay btn-sm" href={b.linkUrl}>{b.linkLabel || "See more"}</Link> : null}
            </div>
          ))}
        </section>
      ) : null}

      {nothingYet ? (
        <section className="mx-auto max-w-6xl px-4 py-10">
          <div className="card px-6 py-12 text-center">
            <p className="font-serif text-2xl text-plum">Our online shop is being stocked</p>
            <p className="mx-auto mt-2 max-w-md text-ink-soft">Products will appear here soon. In the meantime, visit us or get in touch to order.</p>
          </div>
        </section>
      ) : null}

      {/* Categories as an index, not tiles */}
      {catsWithProducts.length ? (
        <section className="mx-auto max-w-6xl px-4 py-10" aria-labelledby="cats-h">
          <h2 id="cats-h" className="mb-5 text-3xl">Shop by category</h2>
          <ul className="grid border-t border-line sm:grid-cols-2 sm:gap-x-10">
            {catsWithProducts.map((c) => (
              <li key={c.id} className="border-b border-line">
                <Link href={`/shop?category=${c.slug}`} className="group flex items-baseline justify-between gap-4 py-4">
                  <span className="font-serif text-2xl text-plum group-hover:text-clay">{c.name}</span>
                  <span className="text-sm text-ink-soft tabular-nums">{c.count} {c.count === 1 ? "product" : "products"}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {featured.length ? (
        <section className="mx-auto max-w-6xl px-4 py-10" aria-labelledby="feat-h">
          <div className="mb-6 flex items-end justify-between">
            <h2 id="feat-h" className="text-3xl">Our selection</h2>
            <Link className="link text-sm" href="/shop">See everything</Link>
          </div>
          <ProductGrid items={featured} />
        </section>
      ) : null}

      {best.length ? (
        <section className="mx-auto max-w-6xl px-4 py-10" aria-labelledby="best-h">
          <h2 id="best-h" className="mb-1 text-3xl">Most bought this season</h2>
          <p className="mb-6 text-ink-soft">Based on orders over the last 90 days.</p>
          <ProductGrid items={best} />
        </section>
      ) : null}

      {usablePromos.length ? (
        <section className="mx-auto max-w-6xl px-4 py-6" aria-label="Current offers">
          <ul className="grid gap-3 sm:grid-cols-3">
            {usablePromos.map((p) => (
              <li key={p.id} className="rounded-sm bg-plum px-5 py-4 text-ivory-50">
                <p className="font-serif text-xl">{p.name}</p>
                <p className="mt-1 text-sm text-plum-100">
                  {p.type === "PERCENT" ? `${p.value}% off` : p.type === "FIXED" ? `${formatKES(p.value)} off` : "Free delivery"}
                  {p.minOrderCents ? ` on orders over ${formatKES(p.minOrderCents)}` : ""}
                  {p.code ? <> with code <strong className="text-white">{p.code}</strong></> : ""}
                  {p.endsAt ? ` · until ${p.endsAt.toLocaleDateString("en-KE", { day: "numeric", month: "short", timeZone: "Africa/Nairobi" })}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {fresh.length ? (
        <section className="mx-auto max-w-6xl px-4 py-10" aria-labelledby="new-h">
          <h2 id="new-h" className="mb-6 text-3xl">New in the shop</h2>
          <ProductGrid items={fresh.slice(0, 4)} />
        </section>
      ) : null}

      {business.about.body ? (
        <section className="mt-6 bg-ivory-200/60 py-14" aria-labelledby="about-h">
          <div className="mx-auto grid max-w-6xl gap-8 px-4 md:grid-cols-[1fr_2fr]">
            <h2 id="about-h" className="text-3xl">{business.about.title}</h2>
            <div className="prose-shop text-lg leading-relaxed text-ink">
              {business.about.body.split(/\n{2,}/).map((para, i) => (
                <p key={i}>{para}</p>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {reviews.length ? (
        <section className="mx-auto max-w-6xl px-4 py-12" aria-labelledby="rev-h">
          <h2 id="rev-h" className="mb-6 text-3xl">From our customers</h2>
          <ul className="grid gap-6 md:grid-cols-3">
            {reviews.map((r) => (
              <li key={r.id} className="border-t-2 border-plum pt-4">
                <Stars value={r.rating} />
                <blockquote className="mt-2 text-ink">“{r.body}”</blockquote>
                <p className="mt-3 text-sm text-ink-soft">
                  {r.displayName}
                  {r.verifiedPurchase ? " · verified purchase" : ""}
                  {r.product ? <> · <Link className="link" href={`/products/${r.product.slug}`}>{r.product.name}</Link></> : null}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {business.faqs.length ? (
        <section className="mx-auto max-w-3xl px-4 py-12" aria-labelledby="faq-h">
          <h2 id="faq-h" className="mb-5 text-3xl">Questions people ask</h2>
          <div className="divide-y divide-line border-y border-line">
            {business.faqs.map((f, i) => (
              <details key={i} className="group py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold text-plum">
                  {f.q}
                  <span aria-hidden="true" className="text-xl transition-transform group-open:rotate-45">+</span>
                </summary>
                <p className="mt-2 max-w-prose text-ink-soft">{f.a}</p>
              </details>
            ))}
          </div>
        </section>
      ) : null}

      <section className="mx-auto max-w-6xl px-4 py-12" aria-labelledby="news-h">
        <div className="grid items-center gap-6 rounded-sm border border-line bg-ivory-50 p-6 md:grid-cols-2 md:p-10">
          <div>
            <h2 id="news-h" className="text-3xl">New stock and offers, by email</h2>
            <p className="mt-2 text-ink-soft">One or two emails a month. Unsubscribe from any email.</p>
          </div>
          <ActionForm action={newsletterAction} resetOnSuccess className="space-y-3">
            <div className="flex gap-2">
              <input className="input" type="email" name="email" placeholder="you@example.com" required aria-label="Email address" autoComplete="email" />
              <SubmitButton className="btn-primary shrink-0">Subscribe</SubmitButton>
            </div>
            <label className="flex items-start gap-2 text-sm text-ink-soft">
              <input type="checkbox" name="consent" className="checkbox mt-0.5" required />
              I agree to receive emails about new products and offers.
            </label>
          </ActionForm>
        </div>
      </section>
    </>
  );
}
