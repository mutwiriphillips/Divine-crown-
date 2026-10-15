import Link from "next/link";
import { asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { cartLines, currentCustomerId, getCart, reconcileCart } from "@/lib/cart";
import { getDefaultLocationId } from "@/lib/inventory";
import { imageCrop, mediaUrl } from "@/lib/media";
import { formatKES } from "@/lib/money";
import { priceCart } from "@/lib/pricing";
import { getSetting } from "@/lib/settings";
import { whatsappUrl } from "@/lib/text";
import { ChatIcon } from "@/components/shop/chat-icon";
import { ActionForm, SubmitButton } from "@/components/forms";
import { applyCouponAction, updateCartAction } from "../actions";

export const metadata = { title: "Your cart" };

export default async function CartPage() {
  const cart = await getCart(false);
  const lines = cart ? await cartLines(cart.id) : [];
  if (!cart || lines.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-4xl">Your cart is empty</h1>
        <p className="mt-3 text-ink-soft">Find something you like and it will show up here.</p>
        <Link className="btn-primary mt-6" href="/shop">Browse the shop</Link>
      </div>
    );
  }
  const commerce = await getSetting("commerce");
  const customerId = await currentCustomerId();
  const customer = customerId ? await db.query.customers.findFirst({ where: eq(schema.customers.id, customerId) }) : null;
  const priced = await priceCart(db, lines, {
    channel: "ONLINE",
    customerId,
    isWholesaleCustomer: !!customer?.isWholesale,
    couponCode: cart.couponCode,
    fulfilment: "COLLECTION",
    locationId: await getDefaultLocationId(),
    settings: commerce,
  });
  await reconcileCart(cart.id, priced);
  const business = await getSetting("business");
  const waCart = priced.lines.length
    ? whatsappUrl(
        business.whatsapp,
        [
          `Hello ${business.name}, I would like to order:`,
          ...priced.lines.map((l) => `- ${l.qty} × ${l.productName}${l.variantName && l.variantName !== "Default" ? ` (${l.variantName})` : ""}: ${formatKES(l.lineSubtotalCents)}`),
          `Total: ${formatKES(priced.totalCents)} (delivery to be confirmed)`,
        ].join("\n"),
      )
    : null;
  const imgs = priced.lines.length
    ? await db.select().from(schema.productImages).where(inArray(schema.productImages.productId, priced.lines.map((l) => l.productId))).orderBy(asc(schema.productImages.sortOrder))
    : [];
  const removed = priced.issues.filter((i) => i.variantId && !priced.lines.some((l) => l.variantId === i.variantId));

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="mb-6 text-4xl">Your cart</h1>
      {priced.issues.length ? (
        <div role="status" className="mb-6 rounded bg-warn-100 px-4 py-3 text-sm text-warn">
          <ul className="list-disc pl-5">
            {priced.issues.map((i, n) => (
              <li key={n}>{i.message}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="grid gap-10 lg:grid-cols-[1fr_360px]">
        <ul className="divide-y divide-line border-y border-line">
          {priced.lines.map((l) => {
            const im = imgs.find((i) => i.productId === l.productId);
            return (
              <li key={l.variantId} className="flex gap-4 py-5">
                <Link href={`/products/${l.slug}`} className="h-24 w-24 shrink-0 overflow-hidden rounded-sm bg-ivory-200">
                  {im ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={mediaUrl(im.assetId, 160, imageCrop(im))} alt="" className="h-full w-full object-contain p-1" />
                  ) : null}
                </Link>
                <div className="flex flex-1 flex-col justify-between gap-2 sm:flex-row">
                  <div>
                    <Link href={`/products/${l.slug}`} className="font-serif text-lg text-plum hover:underline">{l.productName}</Link>
                    <p className="text-sm text-ink-soft">{l.variantName} · {formatKES(l.unitPriceCents)} each{l.isWholesalePrice ? " (wholesale)" : ""}</p>
                    {l.lineDiscountCents ? <p className="text-sm text-ok">Offer: −{formatKES(l.lineDiscountCents)}</p> : null}
                    <div className="mt-2 flex items-center gap-2">
                      <ActionForm action={updateCartAction}>
                        <input type="hidden" name="variantId" value={l.variantId} />
                        <input type="hidden" name="op" value="dec" />
                        <button className="btn-secondary btn-sm h-9 w-9 p-0" aria-label={`One fewer ${l.productName}`}>−</button>
                      </ActionForm>
                      <span className="w-8 text-center tabular-nums" aria-label="Quantity">{l.qty}</span>
                      <ActionForm action={updateCartAction}>
                        <input type="hidden" name="variantId" value={l.variantId} />
                        <input type="hidden" name="op" value="inc" />
                        <button className="btn-secondary btn-sm h-9 w-9 p-0" aria-label={`One more ${l.productName}`} disabled={l.qty >= l.available}>+</button>
                      </ActionForm>
                      <ActionForm action={updateCartAction}>
                        <input type="hidden" name="variantId" value={l.variantId} />
                        <input type="hidden" name="op" value="remove" />
                        <button className="btn-ghost btn-sm">Remove</button>
                      </ActionForm>
                    </div>
                  </div>
                  <p className="font-semibold tabular-nums">{formatKES(l.lineTotalCents)}</p>
                </div>
              </li>
            );
          })}
          {removed.length && !priced.lines.length ? <li className="py-5 text-ink-soft">Nothing in your cart can be bought right now.</li> : null}
        </ul>
        <aside className="h-fit space-y-4 rounded-sm border border-line bg-ivory-50 p-5">
          <h2 className="text-2xl">Summary</h2>
          <dl className="space-y-2 text-[15px]">
            <div className="flex justify-between"><dt>Items</dt><dd className="tabular-nums">{formatKES(priced.lines.reduce((a, l) => a + l.lineSubtotalCents, 0))}</dd></div>
            {priced.discountCents ? <div className="flex justify-between text-ok"><dt>Discounts</dt><dd className="tabular-nums">−{formatKES(priced.discountCents)}</dd></div> : null}
            <div className="flex justify-between text-ink-soft"><dt>Delivery</dt><dd>Chosen at checkout</dd></div>
            <div className="flex justify-between border-t border-line pt-2 text-lg font-semibold"><dt>Total</dt><dd className="tabular-nums">{formatKES(priced.totalCents)}</dd></div>
            {priced.taxCents && priced.taxInclusive ? <p className="text-[13px] text-ink-soft">Includes VAT of {formatKES(priced.taxCents)}.</p> : null}
          </dl>
          {priced.appliedPromotions.length ? (
            <ul className="text-sm text-ok">{priced.appliedPromotions.map((p) => <li key={p.id}>{p.name}: −{formatKES(p.amountCents)}</li>)}</ul>
          ) : null}
          <ActionForm action={applyCouponAction} className="space-y-2">
            <label className="field-label" htmlFor="code">Discount code</label>
            <div className="flex gap-2">
              <input className="input input-sm uppercase" id="code" name="code" defaultValue={cart.couponCode ?? ""} autoComplete="off" />
              <SubmitButton className="btn-secondary btn-sm">{cart.couponCode ? "Update" : "Apply"}</SubmitButton>
            </div>
            {priced.couponMessage ? <p className="text-sm text-warn">{priced.couponMessage}</p> : null}
          </ActionForm>
          {priced.lines.length ? (
            <Link href="/checkout" className="btn-primary w-full">Go to checkout</Link>
          ) : null}
          {waCart ? (
            <a href={waCart} target="_blank" rel="noopener" className="btn-secondary w-full gap-2">
              <ChatIcon className="h-5 w-5" /> Send this order on WhatsApp
            </a>
          ) : null}
          <Link href="/shop" className="block text-center text-sm link">Continue shopping</Link>
        </aside>
      </div>
    </div>
  );
}
