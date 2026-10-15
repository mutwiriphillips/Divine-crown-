import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { currentCustomerId } from "@/lib/cart";
import { orderReviewEligibility } from "@/lib/reviews";
import { OrderView } from "@/components/shop/order-view";
import { ActionForm, SubmitButton } from "@/components/forms";
import { submitOrderFeedbackAction } from "@/app/(shop)/review-actions";

export const metadata = { title: "Order" };

export default async function AccountOrderPage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  const cid = await currentCustomerId();
  const order = await db.query.orders.findFirst({ where: eq(schema.orders.number, number) });
  if (!order || !cid || order.customerId !== cid) notFound();
  const elig = await orderReviewEligibility(cid, order.id);
  const remaining = (["EXPERIENCE", "DELIVERY"] as const).filter((t) => !elig.existingTypes?.includes(t) && (t !== "DELIVERY" || ["LOCAL_DELIVERY", "COURIER"].includes(order.fulfilmentMethod)));
  return (
    <div className="space-y-10">
      <OrderView orderId={order.id} accessKey={null} />
      {elig.eligible && remaining.length ? (
        <section className="card p-5">
          <h2 className="mb-3 text-2xl">How did we do?</h2>
          <ActionForm action={submitOrderFeedbackAction} className="space-y-4">
            <input type="hidden" name="orderId" value={order.id} />
            {remaining.map((t) => (
              <fieldset key={t} className="space-y-2">
                <legend className="font-semibold">{t === "EXPERIENCE" ? "Your shopping experience" : "The delivery"}</legend>
                <div className="flex flex-wrap gap-3">
                  {[5, 4, 3, 2, 1].map((n) => (
                    <label key={n} className="flex items-center gap-1 text-sm">
                      <input type="radio" name={`rating_${t}`} value={n} /> {n}★
                    </label>
                  ))}
                </div>
                <textarea className="input min-h-[60px]" name={`body_${t}`} placeholder="Anything we should know? (optional)" aria-label="Comments" />
              </fieldset>
            ))}
            <SubmitButton>Send feedback</SubmitButton>
          </ActionForm>
          <p className="mt-3 text-sm text-ink-soft">To review a product, open it in the shop — you&apos;ll see a &quot;Write a review&quot; option.</p>
        </section>
      ) : null}
    </div>
  );
}
