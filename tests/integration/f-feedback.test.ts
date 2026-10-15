/** F. Reviews: only buyers can review, one review per product, nothing shows until approved; claims guard. */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db, schema } from "@/db";
import { approvedReviews } from "@/lib/catalog";
import { checkClaims } from "@/lib/claims";
import { placeOnlineOrder } from "@/lib/orders";
import { handleStkCallback, initiateStkPush } from "@/lib/payments/mpesa";
import { productReviewEligibility } from "@/lib/reviews";
import { guestCheckout, makeCustomer, makeProduct, stkCallback } from "../fixtures";

describe("F. feedback and moderation", () => {
  it("lets a customer review only after a paid purchase, once, and hides it until approved", async () => {
    const { customer } = await makeCustomer();
    const { product, variant, locationId } = await makeProduct({ priceKes: 350, stock: 5 });
    expect((await productReviewEligibility(customer.id, product.id)).reason).toBe("not_purchased");
    expect((await productReviewEligibility(null, product.id)).reason).toBe("signin");

    const { order } = await placeOnlineOrder(guestCheckout(variant.id, 1, 35000, locationId, { userCustomerId: customer.id, contact: { name: customer.name, phone: customer.phone!, email: customer.email } }));
    // Unpaid orders don't count as purchases.
    expect((await productReviewEligibility(customer.id, product.id)).eligible).toBe(false);
    const stk = await initiateStkPush(order.id, "254712345678");
    await handleStkCallback(stkCallback(stk.checkoutRequestId, 0, { amountKes: 350 }), { ip: null, provider: "test" });

    const el = await productReviewEligibility(customer.id, product.id);
    expect(el.eligible).toBe(true);
    const [review] = await db.insert(schema.reviews).values({ type: "PRODUCT", productId: product.id, orderId: order.id, customerId: customer.id, rating: 5, body: "Lovely scent", displayName: "W.", verifiedPurchase: true }).returning();
    expect(review.status).toBe("PENDING");
    expect(await approvedReviews(product.id)).toHaveLength(0);

    await db.update(schema.reviews).set({ status: "APPROVED" }).where(eq(schema.reviews.id, review.id));
    expect(await approvedReviews(product.id)).toHaveLength(1);
    expect((await productReviewEligibility(customer.id, product.id)).reason).toBe("already");
    await expect(db.insert(schema.reviews).values({ type: "PRODUCT", productId: product.id, customerId: customer.id, rating: 1, body: "dup", displayName: "W." })).rejects.toThrow();
    await expect(db.insert(schema.reviews).values({ type: "EXPERIENCE", customerId: customer.id, orderId: order.id, rating: 9, body: "x", displayName: "W." })).rejects.toThrow();
  });

  it("flags medical and guaranteed-result wording for owner review", () => {
    expect(checkClaims({ description: "Cures diabetes and guaranteed to bring money in 3 days" }).length).toBeGreaterThan(0);
    expect(checkClaims({ description: "A fragrant oil for massage. Patch test before use." })).toHaveLength(0);
    void randomUUID;
  });
});
