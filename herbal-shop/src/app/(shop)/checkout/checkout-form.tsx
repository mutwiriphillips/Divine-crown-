"use client";

import Link from "next/link";
import { useActionState, useEffect, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/lib/actions";
import { formatKES } from "@/lib/money";

type Quote = {
  itemsCents: number;
  lines: { name: string; qty: number; totalCents: number }[];
  subtotalCents: number;
  discountCents: number;
  deliveryFeeCents: number;
  taxCents: number;
  totalCents: number;
  taxInclusive: boolean;
  issues: string[];
  promotions: { name: string; amountCents: number }[];
  couponMessage: string | null;
  etaText: string | null;
} | null;

type Zone = { id: string; name: string; method: "LOCAL_DELIVERY" | "COURIER" | string; feeCents: number; freeOverCents: number | null; etaText: string | null };

function PlaceButton({ disabled, total }: { disabled: boolean; total: number | null }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary w-full text-base" disabled={disabled || pending}>
      {pending ? "Placing order…" : total != null ? `Place order · ${formatKES(total)}` : "Place order"}
    </button>
  );
}

export function CheckoutForm(props: {
  action: (p: ActionState, fd: FormData) => Promise<ActionState>;
  quote: (i: { fulfilment: string; deliveryZoneId: string | null }) => Promise<Quote>;
  initialQuote: Quote;
  zones: Zone[];
  collectionEnabled: boolean;
  collectionAddress: string;
  codEnabled: boolean;
  mpesaEnabled: boolean;
  defaults: { name: string; phone: string; email: string; county: string; town: string; area: string; street: string; landmark: string };
  lines: { name: string; qty: number; totalCents: number }[];
  shippingNotes: string[];
}) {
  const [state, formAction] = useActionState(props.action, null);
  const hasLocal = props.zones.some((z) => z.method === "LOCAL_DELIVERY");
  const hasCourier = props.zones.some((z) => z.method === "COURIER");
  const [fulfilment, setFulfilment] = useState<string>(props.collectionEnabled ? "COLLECTION" : hasLocal ? "LOCAL_DELIVERY" : "COURIER");
  const zonesFor = props.zones.filter((z) => z.method === fulfilment);
  const [zoneId, setZoneId] = useState<string | null>(null);
  const [quote, setQuote] = useState<Quote>(props.initialQuote);
  const [loading, startTransition] = useTransition();
  const [key] = useState(() => crypto.randomUUID());
  const [pay, setPay] = useState(props.mpesaEnabled ? "MPESA" : "CASH_ON_DELIVERY");
  const e = state?.errors ?? {};

  useEffect(() => {
    startTransition(async () => {
      setQuote(await props.quote({ fulfilment, deliveryZoneId: fulfilment === "COLLECTION" ? null : zoneId }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fulfilment, zoneId]);

  const needsZone = fulfilment !== "COLLECTION" && !zoneId;
  const blocked = !quote || (quote.issues.length > 0 && !(needsZone && quote.issues.length === 1)) || needsZone || (!props.mpesaEnabled && !props.codEnabled);

  return (
    <form action={formAction} className="grid gap-10 lg:grid-cols-[1fr_380px]">
      <input type="hidden" name="idempotencyKey" value={key} />
      <input type="hidden" name="expectedTotalCents" value={quote?.totalCents ?? 0} />
      <div className="space-y-8">
        <fieldset className="space-y-4">
          <legend className="mb-2 font-serif text-2xl text-plum">Your details</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="field-label" htmlFor="name">Full name</label>
              <input className="input" id="name" name="name" defaultValue={props.defaults.name} autoComplete="name" required aria-invalid={!!e.name} />
              {e.name ? <p className="mt-1 text-sm text-bad">{e.name}</p> : null}
            </div>
            <div>
              <label className="field-label" htmlFor="phone">Phone (M-Pesa number)</label>
              <input className="input" id="phone" name="phone" type="tel" defaultValue={props.defaults.phone} autoComplete="tel" placeholder="0712 345 678" required aria-invalid={!!e.phone} />
              {e.phone ? <p className="mt-1 text-sm text-bad">{e.phone}</p> : null}
            </div>
            <div>
              <label className="field-label" htmlFor="email">Email <span className="font-normal text-ink-soft">(for your receipt)</span></label>
              <input className="input" id="email" name="email" type="email" defaultValue={props.defaults.email} autoComplete="email" />
              {e.email ? <p className="mt-1 text-sm text-bad">{e.email}</p> : null}
            </div>
          </div>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="mb-2 font-serif text-2xl text-plum">Delivery or collection</legend>
          {props.collectionEnabled ? (
            <label className={`flex cursor-pointer items-start gap-3 rounded border p-4 ${fulfilment === "COLLECTION" ? "border-plum bg-plum-50" : "border-line bg-white"}`}>
              <input type="radio" name="fulfilment" value="COLLECTION" checked={fulfilment === "COLLECTION"} onChange={() => setFulfilment("COLLECTION")} className="mt-1" />
              <span>
                <span className="font-semibold">Collect from the shop</span> · free
                {props.collectionAddress ? <span className="block text-sm text-ink-soft">{props.collectionAddress}</span> : null}
              </span>
            </label>
          ) : null}
          {hasLocal ? (
            <label className={`flex cursor-pointer items-start gap-3 rounded border p-4 ${fulfilment === "LOCAL_DELIVERY" ? "border-plum bg-plum-50" : "border-line bg-white"}`}>
              <input type="radio" name="fulfilment" value="LOCAL_DELIVERY" checked={fulfilment === "LOCAL_DELIVERY"} onChange={() => { setFulfilment("LOCAL_DELIVERY"); setZoneId(null); }} className="mt-1" />
              <span><span className="font-semibold">Local delivery</span><span className="block text-sm text-ink-soft">Delivered by our rider</span></span>
            </label>
          ) : null}
          {hasCourier ? (
            <label className={`flex cursor-pointer items-start gap-3 rounded border p-4 ${fulfilment === "COURIER" ? "border-plum bg-plum-50" : "border-line bg-white"}`}>
              <input type="radio" name="fulfilment" value="COURIER" checked={fulfilment === "COURIER"} onChange={() => { setFulfilment("COURIER"); setZoneId(null); }} className="mt-1" />
              <span><span className="font-semibold">Courier anywhere in Kenya</span><span className="block text-sm text-ink-soft">Sent by courier or parcel service</span></span>
            </label>
          ) : null}
          {!props.collectionEnabled && !hasLocal && !hasCourier ? <p className="text-bad">Delivery isn&apos;t set up yet. Please contact the shop to order.</p> : null}

          {fulfilment !== "COLLECTION" ? (
            <div className="grid gap-4 rounded border border-line bg-white p-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="field-label" htmlFor="deliveryZoneId">Delivery area</label>
                <select className="input" id="deliveryZoneId" name="deliveryZoneId" value={zoneId ?? ""} onChange={(ev) => setZoneId(ev.target.value || null)} required>
                  <option value="">Choose your area…</option>
                  {zonesFor.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.name} — {z.feeCents ? formatKES(z.feeCents) : "free"}
                      {z.freeOverCents ? ` (free over ${formatKES(z.freeOverCents)})` : ""}
                    </option>
                  ))}
                </select>
                {quote?.etaText && zoneId ? <p className="field-hint">Usually {quote.etaText}.</p> : null}
              </div>
              <div>
                <label className="field-label" htmlFor="county">County</label>
                <input className="input" id="county" name="county" defaultValue={props.defaults.county} required />
              </div>
              <div>
                <label className="field-label" htmlFor="town">Town</label>
                <input className="input" id="town" name="town" defaultValue={props.defaults.town} required />
              </div>
              <div>
                <label className="field-label" htmlFor="area">Estate / area</label>
                <input className="input" id="area" name="area" defaultValue={props.defaults.area} />
              </div>
              <div>
                <label className="field-label" htmlFor="street">Street / building</label>
                <input className="input" id="street" name="street" defaultValue={props.defaults.street} />
              </div>
              <div className="sm:col-span-2">
                <label className="field-label" htmlFor="landmark">Landmark or directions</label>
                <input className="input" id="landmark" name="landmark" defaultValue={props.defaults.landmark} placeholder="e.g. opposite the Total petrol station" />
              </div>
            </div>
          ) : null}
          {props.shippingNotes.length ? <ul className="rounded bg-warn-100 px-4 py-2 text-sm text-warn">{props.shippingNotes.map((n) => <li key={n}>{n}</li>)}</ul> : null}
        </fieldset>

        <fieldset>
          <legend className="mb-2 font-serif text-2xl text-plum">Payment</legend>
          <div className="space-y-3">
            {props.mpesaEnabled ? (
              <label className={`flex cursor-pointer items-start gap-3 rounded border p-4 ${pay === "MPESA" ? "border-plum bg-plum-50" : "border-line bg-white"}`}>
                <input type="radio" name="paymentMethod" value="MPESA" checked={pay === "MPESA"} onChange={() => setPay("MPESA")} className="mt-1" />
                <span><span className="font-semibold">M-Pesa</span><span className="block text-sm text-ink-soft">After you place the order, we&apos;ll send a payment request to your phone. Enter your M-Pesa PIN to pay.</span></span>
              </label>
            ) : null}
            {props.codEnabled ? (
              <label className={`flex cursor-pointer items-start gap-3 rounded border p-4 ${pay === "CASH_ON_DELIVERY" ? "border-plum bg-plum-50" : "border-line bg-white"}`}>
                <input type="radio" name="paymentMethod" value="CASH_ON_DELIVERY" checked={pay === "CASH_ON_DELIVERY"} onChange={() => setPay("CASH_ON_DELIVERY")} className="mt-1" />
                <span><span className="font-semibold">Pay on delivery or collection</span><span className="block text-sm text-ink-soft">Pay by cash or M-Pesa when you receive your order.</span></span>
              </label>
            ) : null}
            {!props.mpesaEnabled && !props.codEnabled ? <p className="text-bad">Online payment isn&apos;t available yet. Please contact the shop to order.</p> : null}
          </div>
        </fieldset>

        <div>
          <label className="field-label" htmlFor="notes">Order notes <span className="font-normal text-ink-soft">(optional)</span></label>
          <textarea className="input min-h-[70px]" id="notes" name="notes" maxLength={500} />
        </div>
      </div>

      <aside className="h-fit space-y-4 rounded-sm border border-line bg-ivory-50 p-5 lg:sticky lg:top-24">
        <h2 className="text-2xl">Your order</h2>
        <ul className="space-y-2 text-sm">
          {(quote?.lines ?? props.lines).map((l, i) => (
            <li key={i} className="flex justify-between gap-3">
              <span>{l.name} × {l.qty}</span>
              <span className="tabular-nums">{formatKES(l.totalCents)}</span>
            </li>
          ))}
        </ul>
        <dl className={`space-y-2 border-t border-line pt-3 text-[15px] ${loading ? "opacity-60" : ""}`} aria-live="polite">
          {quote ? (
            <>
              <div className="flex justify-between"><dt>Items</dt><dd className="tabular-nums">{formatKES(quote.itemsCents)}</dd></div>
              {quote.promotions.map((p) => (
                <div key={p.name} className="flex justify-between text-ok"><dt>{p.name}</dt><dd className="tabular-nums">−{formatKES(p.amountCents)}</dd></div>
              ))}
              <div className="flex justify-between"><dt>Delivery</dt><dd className="tabular-nums">{fulfilment === "COLLECTION" ? "Free" : zoneId ? (quote.deliveryFeeCents ? formatKES(quote.deliveryFeeCents) : "Free") : "Choose an area"}</dd></div>
              {!quote.taxInclusive && quote.taxCents ? <div className="flex justify-between"><dt>VAT</dt><dd className="tabular-nums">{formatKES(quote.taxCents)}</dd></div> : null}
              <div className="flex justify-between border-t border-line pt-2 text-xl font-semibold"><dt>Total</dt><dd className="tabular-nums">{formatKES(quote.totalCents)}</dd></div>
              {quote.taxInclusive && quote.taxCents ? <p className="text-[13px] text-ink-soft">Includes VAT of {formatKES(quote.taxCents)}.</p> : null}
            </>
          ) : (
            <p>Your cart is empty.</p>
          )}
        </dl>
        {quote?.issues.filter((i) => !(needsZone && i.startsWith("Choose a delivery"))).length ? (
          <div role="alert" className="rounded bg-warn-100 px-3 py-2 text-sm text-warn">
            {quote.issues.map((i) => <p key={i}>{i}</p>)}
            <Link className="link" href="/cart">Review your cart</Link>
          </div>
        ) : null}
        {quote?.couponMessage ? <p className="text-sm text-warn">{quote.couponMessage}</p> : null}
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="acceptPolicies" className="checkbox mt-0.5" required />
          <span>
            I accept the <Link className="link" href="/policies/terms" target="_blank">terms of sale</Link>, <Link className="link" href="/policies/returns" target="_blank">returns policy</Link> and{" "}
            <Link className="link" href="/policies/privacy" target="_blank">privacy notice</Link>.
          </span>
        </label>
        {e.acceptPolicies ? <p className="text-sm text-bad">{e.acceptPolicies}</p> : null}
        <PlaceButton disabled={blocked} total={quote?.totalCents ?? null} />
        {state?.message && !state.ok ? <p role="alert" className="rounded bg-bad-100 px-3 py-2 text-sm text-bad">{state.message}</p> : null}
      </aside>
    </form>
  );
}
