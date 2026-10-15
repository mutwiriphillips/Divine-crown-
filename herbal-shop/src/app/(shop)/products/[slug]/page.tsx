import { whatsappUrl } from "@/lib/text";
import { ChatIcon } from "@/components/shop/chat-icon";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { currentCustomerId } from "@/lib/cart";
import { approvedReviews, getVisibleProduct, relatedProducts } from "@/lib/catalog";
import { STANDARD_DISCLAIMERS } from "@/lib/claims";
import { availability, getDefaultLocationId } from "@/lib/inventory";
import { imageCrop, mediaUrl } from "@/lib/media";
import { formatKES } from "@/lib/money";
import { productReviewEligibility } from "@/lib/reviews";
import { getAllSettings } from "@/lib/settings";
import { ActionForm, FieldError, SubmitButton } from "@/components/forms";
import { AddToCart } from "@/components/shop/add-to-cart";
import { Gallery } from "@/components/shop/gallery";
import { ProductGrid } from "@/components/shop/product-card";
import { Stars } from "@/components/shop/stars";
import { addToCartAction, askQuestionAction, reportReviewAction } from "../../actions";
import { submitProductReviewAction } from "../../review-actions";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const p = await getVisibleProduct((await params).slug);
  return p ? { title: p.name, description: p.description?.slice(0, 160) ?? undefined } : {};
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = await getVisibleProduct(slug);
  if (!p) notFound();
  const [{ business }, loc, reviews, related, customerId, zones, questions] = await Promise.all([
    getAllSettings(),
    getDefaultLocationId(),
    approvedReviews(p.id),
    relatedProducts(p.id, p.categoryId),
    currentCustomerId(),
    db.query.deliveryZones.findMany({ where: eq(schema.deliveryZones.isActive, true), orderBy: (z) => z.sortOrder }),
    db.query.productQuestions.findMany({ where: and(eq(schema.productQuestions.productId, p.id), eq(schema.productQuestions.status, "PUBLISHED")), orderBy: (q) => q.createdAt }),
  ]);
  const avail = await availability(db, p.variants.map((v) => v.id), loc);
  const variants = p.variants.map((v) => ({ id: v.id, name: v.name, priceCents: v.priceCents!, compareAtCents: v.compareAtCents, available: avail.get(v.id) ?? 0 }));
  const images = p.images.map((im) => ({
    src: mediaUrl(im.assetId, 960, imageCrop(im)),
    large: mediaUrl(im.assetId, 1600),
    thumb: mediaUrl(im.assetId, 160, imageCrop(im)),
    alt: im.alt ?? p.name,
  }));
  const avg = reviews.length ? reviews.reduce((a, r) => a + r.rating, 0) / reviews.length : null;
  const elig = await productReviewEligibility(customerId, p.id);
  const disclaimer = STANDARD_DISCLAIMERS[p.productType];
  const priced = variants.filter((v) => v.priceCents != null);
  const priceText = priced.length === 1 ? ` (${formatKES(priced[0].priceCents!)})` : "";
  const wa = whatsappUrl(business.whatsapp, `Hello ${business.name}, I would like to order: ${p.name}${priceText}.\n${process.env.APP_URL ?? ""}/products/${p.slug}`);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <nav aria-label="Breadcrumb" className="mb-5 text-sm text-ink-soft">
        <Link className="hover:text-plum" href="/shop">Shop</Link>
        {p.category ? (
          <>
            {" / "}
            <Link className="hover:text-plum" href={`/shop?category=${p.category.slug}`}>{p.category.name}</Link>
          </>
        ) : null}
      </nav>
      <div className="grid gap-10 md:grid-cols-2">
        <Gallery images={images} name={p.name} />
        <div>
          {p.brand ? <p className="text-ink-soft">{p.brand}</p> : null}
          <h1 className="mt-1 text-4xl leading-tight">{p.name}</h1>
          {avg ? (
            <a href="#reviews" className="mt-2 inline-flex items-center gap-2 text-sm text-ink-soft">
              <Stars value={avg} /> {avg.toFixed(1)} · {reviews.length} review{reviews.length === 1 ? "" : "s"}
            </a>
          ) : null}
          <div className="mt-6">
            <AddToCart variants={variants} action={addToCartAction} />
          </div>
          {wa ? (
            <a href={wa} target="_blank" rel="noopener" className="btn-secondary mt-3 w-full gap-2 sm:w-auto">
              <ChatIcon className="h-5 w-5" /> Order on WhatsApp
            </a>
          ) : null}
          {p.shippingRestriction ? <p className="mt-4 rounded bg-warn-100 px-3 py-2 text-sm text-warn">{p.shippingRestriction}</p> : null}
          <div className="mt-6 border-t border-line pt-5 text-sm">
            <p className="font-semibold">Getting it</p>
            <ul className="mt-2 space-y-1 text-ink-soft">
              <li>Collect from the shop{business.town ? ` in ${business.town}` : ""}.</li>
              {zones.map((z) => (
                <li key={z.id}>
                  {z.name}: {z.feeCents === 0 ? "free delivery" : formatKES(z.feeCents)}
                  {z.freeOverCents ? ` (free over ${formatKES(z.freeOverCents)})` : ""}
                  {z.etaText ? ` · ${z.etaText}` : ""}
                </li>
              ))}
            </ul>
            {wa ? (
              <p className="mt-3">
                <a className="link" href={whatsappUrl(business.whatsapp, `Hello ${business.name}, I have a question about ${p.name}.`)!} target="_blank" rel="noopener">
                  Ask about this product on WhatsApp
                </a>
                {business.email ? <> or email <a className="link" href={`mailto:${business.email}?subject=${encodeURIComponent(p.name)}`}>{business.email}</a></> : null}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-12 grid gap-10 md:grid-cols-[2fr_1fr]">
        <div className="space-y-8">
          {p.description ? (
            <section>
              <h2 className="mb-3 text-2xl">About this product</h2>
              <div className="prose-shop text-[17px] leading-relaxed">
                {p.description.split(/\n{2,}/).map((t, i) => (
                  <p key={i} className="whitespace-pre-line">{t}</p>
                ))}
              </div>
            </section>
          ) : null}
          {p.usageInstructions ? (
            <section>
              <h2 className="mb-3 text-2xl">How to use</h2>
              <p className="max-w-prose whitespace-pre-line">{p.usageInstructions}</p>
            </section>
          ) : null}
          {p.ingredients && p.ingredientsVerified ? (
            <section>
              <h2 className="mb-3 text-2xl">Ingredients</h2>
              <p className="max-w-prose whitespace-pre-line">{p.ingredients}</p>
            </section>
          ) : null}
          {p.warnings || disclaimer ? (
            <section className="rounded-sm border-l-4 border-clay bg-clay-100/50 px-5 py-4">
              <h2 className="mb-2 font-sans text-base font-semibold text-clay-700">Please note</h2>
              {p.warnings ? <p className="whitespace-pre-line">{p.warnings}</p> : null}
              {disclaimer ? <p className="mt-2 text-sm text-ink-soft">{disclaimer}</p> : null}
            </section>
          ) : null}

          <section id="reviews" aria-labelledby="rev-h">
            <h2 id="rev-h" className="mb-4 text-2xl">Reviews</h2>
            {reviews.length === 0 ? <p className="text-ink-soft">No reviews yet.</p> : null}
            <ul className="divide-y divide-line">
              {reviews.map((r) => (
                <li key={r.id} className="py-5">
                  <div className="flex flex-wrap items-center gap-3">
                    <Stars value={r.rating} />
                    {r.title ? <span className="font-semibold">{r.title}</span> : null}
                  </div>
                  {r.body ? <p className="mt-2 max-w-prose whitespace-pre-line">{r.body}</p> : null}
                  <p className="mt-2 text-sm text-ink-soft">
                    {r.displayName}
                    {r.verifiedPurchase ? " · verified purchase" : ""} · {r.createdAt.toLocaleDateString("en-KE", { timeZone: "Africa/Nairobi" })}
                  </p>
                  {r.adminResponse ? (
                    <div className="mt-3 rounded bg-ivory-200/70 px-4 py-3 text-sm">
                      <p className="font-semibold">Reply from {business.name}</p>
                      <p className="mt-1 whitespace-pre-line">{r.adminResponse}</p>
                    </div>
                  ) : null}
                  <details className="mt-2 text-[13px]">
                    <summary className="cursor-pointer text-ink-faint">Report this review</summary>
                    <ActionForm action={reportReviewAction} className="mt-2 flex gap-2">
                      <input type="hidden" name="reviewId" value={r.id} />
                      <input className="input input-sm flex-1" name="reason" placeholder="What's wrong with it?" aria-label="Reason" />
                      <SubmitButton className="btn-secondary btn-sm">Report</SubmitButton>
                    </ActionForm>
                  </details>
                </li>
              ))}
            </ul>
            <div className="mt-6">
              {elig.eligible ? (
                <details className="card p-5">
                  <summary className="cursor-pointer font-semibold text-plum">Write a review</summary>
                  <ActionForm action={submitProductReviewAction} className="mt-4 space-y-3">
                    <input type="hidden" name="productId" value={p.id} />
                    <fieldset>
                      <legend className="field-label">Your rating</legend>
                      <div className="flex gap-3">
                        {[5, 4, 3, 2, 1].map((n) => (
                          <label key={n} className="flex items-center gap-1 text-sm">
                            <input type="radio" name="rating" value={n} required /> {n}★
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    <input className="input" name="title" placeholder="Headline (optional)" aria-label="Headline" />
                    <textarea className="input min-h-[100px]" name="body" placeholder="What did you think?" aria-label="Review" />
                    <input className="input" name="displayName" placeholder="Name to show (optional)" aria-label="Display name" />
                    <FieldError name="rating" />
                    <SubmitButton>Submit review</SubmitButton>
                  </ActionForm>
                </details>
              ) : elig.reason === "signin" ? (
                <p className="text-sm text-ink-soft"><Link className="link" href={`/login?next=/products/${p.slug}`}>Sign in</Link> to review products you&apos;ve bought.</p>
              ) : elig.reason === "already" ? (
                <p className="text-sm text-ink-soft">Thanks for reviewing this product{elig.review?.status === "PENDING" ? " — your review is waiting to be checked" : ""}.</p>
              ) : (
                <p className="text-sm text-ink-soft">Reviews are from customers who bought this product from us.</p>
              )}
            </div>
          </section>
        </div>

        <aside aria-labelledby="qa-h">
          <h2 id="qa-h" className="mb-4 text-2xl">Questions</h2>
          {questions.length ? (
            <ul className="mb-6 space-y-4">
              {questions.map((q) => (
                <li key={q.id}>
                  <p className="font-semibold">{q.question}</p>
                  <p className="mt-1 text-ink-soft">{q.answer}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-4 text-ink-soft">No questions yet.</p>
          )}
          <ActionForm action={askQuestionAction} className="space-y-2" resetOnSuccess>
            <input type="hidden" name="productId" value={p.id} />
            <label className="field-label" htmlFor="question">Ask a question</label>
            <textarea className="input min-h-[80px]" id="question" name="question" required />
            <input className="input" name="name" placeholder="Your first name" aria-label="Your first name" />
            <SubmitButton className="btn-secondary">Send question</SubmitButton>
          </ActionForm>
        </aside>
      </div>

      {related.length ? (
        <section className="mt-16" aria-labelledby="rel-h">
          <h2 id="rel-h" className="mb-6 text-3xl">You may also like</h2>
          <ProductGrid items={related} />
        </section>
      ) : null}
    </div>
  );
}
