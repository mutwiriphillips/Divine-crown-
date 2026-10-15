"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/lib/actions";
import { formatKES } from "@/lib/money";

type Variant = { id: string; name: string; priceCents: number; compareAtCents: number | null; available: number };

function Buttons({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <div className="flex flex-wrap gap-2">
      <button type="submit" className="btn-primary flex-1 px-6" disabled={disabled || pending}>
        {pending ? "Adding…" : "Add to cart"}
      </button>
      <button type="submit" name="buyNow" value="1" className="btn-secondary flex-1" disabled={disabled || pending}>
        Buy now
      </button>
    </div>
  );
}

export function AddToCart({ variants, action }: { variants: Variant[]; action: (p: ActionState, fd: FormData) => Promise<ActionState> }) {
  const [state, formAction] = useActionState(action, null);
  const [vid, setVid] = useState(variants.find((v) => v.available > 0)?.id ?? variants[0]?.id);
  const [qty, setQty] = useState(1);
  const v = variants.find((x) => x.id === vid) ?? variants[0];
  if (!v) return null;
  const max = Math.min(99, Math.max(1, v.available));
  const out = v.available <= 0;
  return (
    <form action={formAction} className="space-y-4">
      <p className="flex items-baseline gap-3">
        <span className="text-3xl font-semibold tabular-nums text-ink">{formatKES(v.priceCents)}</span>
        {v.compareAtCents && v.compareAtCents > v.priceCents ? <s className="text-lg text-ink-faint tabular-nums">{formatKES(v.compareAtCents)}</s> : null}
      </p>
      {variants.length > 1 ? (
        <fieldset>
          <legend className="field-label">Size</legend>
          <div className="flex flex-wrap gap-2">
            {variants.map((x) => (
              <label key={x.id} className={`cursor-pointer rounded border px-3 py-2 text-sm ${x.id === vid ? "border-plum bg-plum-50 font-semibold text-plum" : "border-line bg-white"} ${x.available <= 0 ? "opacity-60" : ""}`}>
                <input type="radio" name="variantRadio" value={x.id} checked={x.id === vid} onChange={() => { setVid(x.id); setQty(1); }} className="sr-only" />
                {x.name} · {formatKES(x.priceCents)}
                {x.available <= 0 ? " · out of stock" : ""}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      <input type="hidden" name="variantId" value={v.id} />
      <p className={`text-sm font-semibold ${out ? "text-bad" : "text-ok"}`}>
        {out ? "Out of stock" : v.available <= 3 ? `In stock — ${v.available} left` : "In stock"}
      </p>
      {!out ? (
        <div className="flex items-center gap-3">
          <label htmlFor="qty" className="text-sm font-semibold">Quantity</label>
          <div className="flex items-center rounded border border-line bg-white">
            <button type="button" className="h-11 w-11 text-lg" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Decrease quantity">−</button>
            <input id="qty" name="qty" type="number" min={1} max={max} value={qty} onChange={(e) => setQty(Math.min(max, Math.max(1, Number(e.target.value) || 1)))} className="h-11 w-14 border-x border-line text-center tabular-nums" />
            <button type="button" className="h-11 w-11 text-lg" onClick={() => setQty((q) => Math.min(max, q + 1))} aria-label="Increase quantity">+</button>
          </div>
        </div>
      ) : (
        <input type="hidden" name="qty" value="1" />
      )}
      <Buttons disabled={out} />
      {state?.message ? (
        <p role={state.ok ? "status" : "alert"} className={`rounded px-3 py-2 text-sm ${state.ok ? "bg-ok-100 text-ok" : "bg-bad-100 text-bad"}`}>
          {state.message} {state.ok ? <Link className="link font-semibold" href="/cart">View cart</Link> : null}
        </p>
      ) : null}
    </form>
  );
}
