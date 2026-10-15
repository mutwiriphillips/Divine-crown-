"use server";

import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { action, int, optStr, str, UserError } from "@/lib/actions";
import { getCurrentUser } from "@/lib/auth/server";
import { currentCustomerId } from "@/lib/cart";
import { notifyStaff } from "@/lib/notifications";
import { rateLimit } from "@/lib/ratelimit";
import { orderReviewEligibility, productReviewEligibility } from "@/lib/reviews";

function displayName(full: string, chosen: string | null) {
  if (chosen) return chosen.slice(0, 40);
  const [first, last] = full.trim().split(/\s+/);
  return last ? `${first} ${last[0]}.` : first;
}

/** Reviews are held for moderation; only approved ones are shown. Ratings are never edited or inflated. */
export const submitProductReviewAction = action(async (fd) => {
  const user = await getCurrentUser();
  if (!user) throw new UserError("Sign in to write a review.");
  if (!(await rateLimit(`review:${user.id}`, 10, 3600))) throw new UserError("Too many reviews in a short time. Try later.");
  const customerId = await currentCustomerId();
  const productId = str(fd, "productId");
  const rating = int(fd, "rating", "rating");
  if (rating < 1 || rating > 5) throw new UserError("Choose a rating from 1 to 5 stars.");
  const elig = await productReviewEligibility(customerId, productId);
  if (!elig.eligible) throw new UserError(elig.reason === "already" ? "You've already reviewed this product." : "You can review products you've bought from us.");
  const body = optStr(fd, "body");
  await db.transaction(async (tx) => {
    const [r] = await tx
      .insert(schema.reviews)
      .values({ type: "PRODUCT", productId, orderId: elig.orderId, customerId: customerId!, rating, title: optStr(fd, "title")?.slice(0, 120), body: body?.slice(0, 3000), displayName: displayName(user.name, optStr(fd, "displayName")), verifiedPurchase: true })
      .returning();
    await notifyStaff(tx, { event: "staff.feedback", entityType: "review", entityId: r.id, dedupeKey: `review:${r.id}`, vars: { kind: "product review", summary: `${rating}★ ${body?.slice(0, 60) ?? ""}` } });
  });
  revalidatePath("/products/[slug]", "page");
  return { ok: true, message: "Thanks! Your review will appear once it's been checked." };
});

export const submitOrderFeedbackAction = action(async (fd) => {
  const user = await getCurrentUser();
  if (!user) throw new UserError("Sign in first.");
  const customerId = await currentCustomerId();
  const orderId = str(fd, "orderId");
  const elig = await orderReviewEligibility(customerId!, orderId);
  if (!elig.eligible) throw new UserError("You can leave feedback once your order is complete.");
  const entries: { type: "EXPERIENCE" | "DELIVERY"; rating: number; body: string | null }[] = [];
  for (const type of ["EXPERIENCE", "DELIVERY"] as const) {
    const raw = str(fd, `rating_${type}`);
    if (!raw) continue;
    const rating = Number(raw);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) continue;
    if (elig.existingTypes?.includes(type)) continue;
    entries.push({ type, rating, body: optStr(fd, `body_${type}`)?.slice(0, 2000) ?? null });
  }
  if (!entries.length) throw new UserError("Choose at least one rating.");
  await db.transaction(async (tx) => {
    for (const e of entries) {
      const [r] = await tx.insert(schema.reviews).values({ ...e, orderId, customerId: customerId!, displayName: displayName(user.name, null), verifiedPurchase: true }).returning();
      await notifyStaff(tx, { event: "staff.feedback", entityType: "review", entityId: r.id, dedupeKey: `review:${r.id}`, vars: { kind: `${e.type.toLowerCase()} feedback`, summary: `${e.rating}★ ${e.body?.slice(0, 60) ?? ""}` } });
    }
  });
  revalidatePath("/account/orders/[number]", "page");
  return { ok: true, message: "Thanks for the feedback." };
});
