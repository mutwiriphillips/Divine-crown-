"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { formatKES, parseKESToCents } from "@/lib/money";
import type { ActionState } from "@/lib/actions";
import type { PosQuote } from "./actions";

export type PosProduct = {
  variantId: string;
  name: string;
  variant: string;
  sku: string | null;
  barcode: string | null;
  priceCents: number;
  categoryId: string | null;
  available: number;
  image: string | null;
};
type Line = { variantId: string; qty: number; overrideUnitCents: number | null };
type Customer = { id: string; name: string; phone: string | null; isWholesale: boolean };
type PayRow = { method: "CASH" | "MPESA" | "CARD" | "BANK_TRANSFER" | "OTHER"; amount: string; reference: string };

type Props = {
  sessionId: string;
  products: PosProduct[];
  categories: { id: string; name: string }[];
  held: { id: string; label: string; createdAt: string }[];
  perms: { discount: boolean; override: boolean };
  manualMpesa: boolean;
  stkAvailable: boolean;
  actions: {
    quote: (i: { lines: Line[]; manualDiscountCents: number; customerId: string | null }) => Promise<PosQuote | { error: string }>;
    complete: (p: unknown) => Promise<ActionState>;
    suspend: (i: { sessionId: string; label: string; cart: unknown }) => Promise<ActionState>;
    resume: (id: string) => Promise<{ cart: unknown } | { error: string }>;
    searchCustomers: (q: string) => Promise<Customer[]>;
    quickCustomer: (name: string, phone: string) => Promise<Customer | { error: string }>;
  };
};

const toCents = (s: string) => {
  try {
    return parseKESToCents(s) ?? 0;
  } catch {
    return NaN;
  }
};

export function PosApp(props: Props) {
  const router = useRouter();
  const [lines, setLines] = useState<Line[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [discount, setDiscount] = useState("");
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const [quote, setQuote] = useState<PosQuote | null>(null);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [pays, setPays] = useState<PayRow[]>([{ method: "CASH", amount: "", reference: "" }]);
  const [stkPhone, setStkPhone] = useState("");
  const [mode, setMode] = useState<"pay" | "stk">("pay");
  const [busy, startBusy] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [done, setDone] = useState<{ number: string; orderId: string; receiptId: string | null; changeCents: number; attemptId: string | null } | null>(null);
  const [online, setOnline] = useState(true);
  const [idemKey, setIdemKey] = useState(() => crypto.randomUUID());
  const searchRef = useRef<HTMLInputElement>(null);

  const byId = useMemo(() => new Map(props.products.map((p) => [p.variantId, p])), [props.products]);

  useEffect(() => {
    const up = () => setOnline(navigator.onLine);
    up();
    window.addEventListener("online", up);
    window.addEventListener("offline", up);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", up);
    };
  }, []);

  // Server-side pricing for the current cart (debounced).
  const discountCents = discount ? toCents(discount) : 0;
  useEffect(() => {
    if (!lines.length) {
      setQuote(null);
      setQuoteErr(null);
      return;
    }
    const t = setTimeout(async () => {
      const r = await props.actions.quote({ lines, manualDiscountCents: Number.isFinite(discountCents) ? discountCents : 0, customerId: customer?.id ?? null });
      if ("error" in r) setQuoteErr(r.error);
      else {
        setQuote(r);
        setQuoteErr(null);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [lines, discountCents, customer, props.actions]);

  const add = useCallback(
    (variantId: string) => {
      const p = byId.get(variantId);
      if (!p) return;
      setLines((ls) => {
        const ex = ls.find((l) => l.variantId === variantId);
        if (ex) return ls.map((l) => (l.variantId === variantId ? { ...l, qty: l.qty + 1 } : l));
        return [...ls, { variantId, qty: 1, overrideUnitCents: null }];
      });
      setMsg(null);
      setDone(null);
    },
    [byId],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return props.products.filter((p) => (!cat || p.categoryId === cat) && (!q || p.name.toLowerCase().includes(q) || p.sku?.toLowerCase() === q || p.barcode === q || p.variant.toLowerCase().includes(q)));
  }, [props.products, search, cat]);

  // Barcode scanners type the code then press Enter.
  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const q = search.trim();
    const exact = props.products.find((p) => p.barcode === q || p.sku?.toLowerCase() === q.toLowerCase());
    if (exact) {
      add(exact.variantId);
      setSearch("");
    } else if (filtered.length === 1) {
      add(filtered[0].variantId);
      setSearch("");
    } else if (!filtered.length) setMsg({ ok: false, text: `No product matches “${q}”.` });
  };

  const total = quote?.totalCents ?? 0;
  const paidCents = pays.reduce((a, p) => a + (Number.isFinite(toCents(p.amount)) ? toCents(p.amount) : 0), 0);
  const nonCash = pays.filter((p) => p.method !== "CASH").reduce((a, p) => a + (Number.isFinite(toCents(p.amount)) ? toCents(p.amount) : 0), 0);
  const change = Math.max(0, paidCents - total);

  const reset = () => {
    setLines([]);
    setCustomer(null);
    setDiscount("");
    setPays([{ method: "CASH", amount: "", reference: "" }]);
    setPaying(false);
    setMode("pay");
    setStkPhone("");
    setIdemKey(crypto.randomUUID());
    searchRef.current?.focus();
  };

  const complete = () =>
    startBusy(async () => {
      setMsg(null);
      const r = await props.actions.complete({
        sessionId: props.sessionId,
        idempotencyKey: idemKey,
        customerId: customer?.id ?? null,
        lines,
        manualDiscountCents: Number.isFinite(discountCents) ? discountCents : 0,
        payments: mode === "stk" ? [] : pays.filter((p) => toCents(p.amount) > 0).map((p) => ({ method: p.method, amountCents: toCents(p.amount), reference: p.reference || null })),
        stkPhone: mode === "stk" ? stkPhone : null,
      });
      if (!r?.ok) {
        setMsg({ ok: false, text: r?.message ?? "Couldn't complete the sale." });
        return;
      }
      const d = r.data as { orderId: string; number: string; receiptId: string | null; changeCents: number; attemptId: string | null };
      setDone(d);
      setMsg({ ok: true, text: r.message ?? "Done." });
      reset();
      router.refresh();
    });

  // When waiting for an M-Pesa prompt, poll the order.
  useEffect(() => {
    if (!done?.attemptId) return;
    let stop = false;
    const started = Date.now();
    const tick = async () => {
      if (stop) return;
      const res = await fetch(`/api/orders/${done.number}/status`, { cache: "no-store" }).then((x) => x.json()).catch(() => null);
      if (res?.paymentStatus === "PAID") {
        setMsg({ ok: true, text: `M-Pesa payment received for ${done.number}.` });
        setDone((d) => (d ? { ...d, attemptId: null } : d));
        router.refresh();
        return;
      }
      if (res?.attempt && ["FAILED", "CANCELLED", "EXPIRED"].includes(res.attempt.status)) {
        setMsg({ ok: false, text: `M-Pesa payment not completed (${res.attempt.resultDesc ?? res.attempt.status}). Open the order to take another payment.` });
        setDone((d) => (d ? { ...d, attemptId: null } : d));
        return;
      }
      if (Date.now() - started < 180_000) setTimeout(tick, 3000);
    };
    tick();
    return () => {
      stop = true;
    };
  }, [done?.attemptId, done?.number, router]);

  const hold = () =>
    startBusy(async () => {
      const label = customer?.name ?? `Sale with ${lines.length} item${lines.length > 1 ? "s" : ""}`;
      const r = await props.actions.suspend({ sessionId: props.sessionId, label, cart: { lines, customer, discount } });
      setMsg({ ok: !!r?.ok, text: r?.message ?? "" });
      if (r?.ok) reset();
      router.refresh();
    });

  const resume = (id: string) =>
    startBusy(async () => {
      const r = await props.actions.resume(id);
      if ("error" in r) return setMsg({ ok: false, text: r.error });
      const c = r.cart as { lines: Line[]; customer: Customer | null; discount: string };
      setLines(c.lines.filter((l) => byId.has(l.variantId)));
      setCustomer(c.customer);
      setDiscount(c.discount ?? "");
      router.refresh();
    });

  const qLine = (id: string) => quote?.lines.find((l) => l.variantId === id);
  const blocked = !online || busy || !lines.length || !quote || !!quoteErr || (quote?.issues.length ?? 0) > 0;
  const payOk = mode === "stk" ? stkPhone.trim().length >= 9 : paidCents >= total && nonCash <= total && pays.every((p) => p.method !== "MPESA" || !toCents(p.amount) || /^[A-Z0-9]{8,12}$/i.test(p.reference.trim()));

  return (
    <div className="grid min-h-[calc(100vh-120px)] gap-4 lg:grid-cols-[1fr_420px]">
      {!online ? (
        <div role="alert" className="rounded bg-bad-100 px-4 py-2 text-bad lg:col-span-2">
          You&apos;re offline. Sales can&apos;t be completed until the connection is back, so stock and payments stay accurate. Take payment details on paper if you must and enter them when online.
        </div>
      ) : null}
      {/* Products */}
      <section className="flex min-h-0 flex-col">
        <div className="flex gap-2">
          <input
            ref={searchRef}
            autoFocus
            className="input"
            placeholder="Search or scan a barcode"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={onSearchKey}
            aria-label="Search products or scan barcode"
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          <button className={`btn-sm btn ${!cat ? "bg-plum text-white" : "btn-secondary"}`} onClick={() => setCat(null)}>All</button>
          {props.categories.map((c) => (
            <button key={c.id} className={`btn-sm btn ${cat === c.id ? "bg-plum text-white" : "btn-secondary"}`} onClick={() => setCat(c.id)}>
              {c.name}
            </button>
          ))}
        </div>
        <ul className="mt-3 grid flex-1 auto-rows-min grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3 xl:grid-cols-4">
          {filtered.map((p) => (
            <li key={p.variantId}>
              <button
                onClick={() => add(p.variantId)}
                disabled={p.available <= 0}
                className="flex h-full w-full flex-col overflow-hidden rounded border border-line bg-white text-left hover:border-plum disabled:opacity-50"
              >
                {p.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.image} alt="" className="h-20 w-full bg-ivory-200 object-contain p-1" loading="lazy" />
                ) : (
                  <span className="h-20 w-full bg-ivory-200" />
                )}
                <span className="flex flex-1 flex-col p-2">
                  <span className="text-[13px] font-semibold leading-tight">{p.name}</span>
                  <span className="text-[12px] text-ink-soft">{p.variant}</span>
                  <span className="mt-auto flex justify-between pt-1 text-[13px]">
                    <span className="tabular-nums">{formatKES(p.priceCents)}</span>
                    <span className={`tabular-nums ${p.available <= 0 ? "text-bad" : "text-ink-soft"}`}>{p.available}</span>
                  </span>
                </span>
              </button>
            </li>
          ))}
          {!filtered.length ? <li className="col-span-full p-6 text-center text-ink-soft">No products match.</li> : null}
        </ul>
      </section>

      {/* Sale */}
      <section className="flex flex-col rounded-md border border-line bg-white">
        <div className="border-b border-line p-3">
          <CustomerPicker customer={customer} setCustomer={setCustomer} search={props.actions.searchCustomers} quick={props.actions.quickCustomer} />
        </div>
        <ul className="flex-1 divide-y divide-line overflow-y-auto">
          {lines.map((l) => {
            const p = byId.get(l.variantId)!;
            const ql = qLine(l.variantId);
            return (
              <li key={l.variantId} className="p-3">
                <div className="flex justify-between gap-2">
                  <span className="text-sm font-semibold">{p.name}<span className="block text-[12px] font-normal text-ink-soft">{p.variant} · {formatKES(ql?.unitPriceCents ?? p.priceCents)} each</span></span>
                  <span className="text-sm tabular-nums">{formatKES(ql?.lineTotalCents ?? p.priceCents * l.qty)}</span>
                </div>
                <div className="mt-2 flex items-center gap-1">
                  <button className="btn-secondary btn-sm h-8 w-8 p-0" onClick={() => setLines((ls) => ls.map((x) => (x.variantId === l.variantId ? { ...x, qty: Math.max(1, x.qty - 1) } : x)))} aria-label="One fewer">−</button>
                  <input className="input input-sm h-8 w-14 text-center" value={l.qty} inputMode="numeric" aria-label="Quantity"
                    onChange={(e) => { const n = Math.max(1, Math.min(999, Number(e.target.value.replace(/\D/g, "")) || 1)); setLines((ls) => ls.map((x) => (x.variantId === l.variantId ? { ...x, qty: n } : x))); }} />
                  <button className="btn-secondary btn-sm h-8 w-8 p-0" onClick={() => add(l.variantId)} aria-label="One more">+</button>
                  {props.perms.override ? (
                    <input
                      className="input input-sm ml-2 h-8 w-24"
                      placeholder="Price"
                      aria-label="Override unit price"
                      defaultValue={l.overrideUnitCents != null ? String(l.overrideUnitCents / 100) : ""}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        const c = v ? toCents(v) : null;
                        if (c !== null && !Number.isFinite(c)) return;
                        setLines((ls) => ls.map((x) => (x.variantId === l.variantId ? { ...x, overrideUnitCents: c } : x)));
                      }}
                    />
                  ) : null}
                  <button className="btn-ghost btn-sm ml-auto" onClick={() => setLines((ls) => ls.filter((x) => x.variantId !== l.variantId))}>Remove</button>
                </div>
              </li>
            );
          })}
          {!lines.length ? <li className="p-6 text-center text-ink-soft">Tap a product or scan a barcode to start a sale.</li> : null}
        </ul>

        <div className="space-y-2 border-t border-line p-3">
          {props.perms.discount ? (
            <label className="flex items-center justify-between gap-2 text-sm">
              Discount (KES)
              <input className="input input-sm w-28 text-right" value={discount} onChange={(e) => setDiscount(e.target.value)} inputMode="decimal" />
            </label>
          ) : null}
          {quote ? (
            <dl className="space-y-1 text-sm">
              {quote.discountCents ? <div className="flex justify-between text-ok"><dt>Discounts</dt><dd>−{formatKES(quote.discountCents)}</dd></div> : null}
              {quote.taxCents ? <div className="flex justify-between text-ink-soft"><dt>VAT {quote.taxInclusive ? "(included)" : ""}</dt><dd>{formatKES(quote.taxCents)}</dd></div> : null}
              <div className="flex justify-between text-2xl font-semibold"><dt>Total</dt><dd className="tabular-nums">{formatKES(quote.totalCents)}</dd></div>
            </dl>
          ) : null}
          {quoteErr ? <p className="text-sm text-bad">{quoteErr}</p> : null}
          {quote?.issues.length ? <ul className="text-sm text-bad">{quote.issues.map((i) => <li key={i}>{i}</li>)}</ul> : null}

          {!paying ? (
            <div className="flex gap-2">
              <button className="btn-secondary" onClick={hold} disabled={!lines.length || busy}>Hold</button>
              <button className="btn-clay flex-1 text-lg" onClick={() => { setPaying(true); setPays([{ method: "CASH", amount: quote ? String(quote.totalCents / 100) : "", reference: "" }]); }} disabled={blocked}>
                Take payment
              </button>
            </div>
          ) : (
            <div className="space-y-2 rounded border border-line bg-ivory-50 p-3">
              <div className="flex gap-1">
                <button className={`btn-sm btn flex-1 ${mode === "pay" ? "bg-plum text-white" : "btn-secondary"}`} onClick={() => setMode("pay")}>Cash / code / card</button>
                {props.stkAvailable ? <button className={`btn-sm btn flex-1 ${mode === "stk" ? "bg-plum text-white" : "btn-secondary"}`} onClick={() => setMode("stk")}>Send M-Pesa prompt</button> : null}
              </div>
              {mode === "pay" ? (
                <>
                  {pays.map((p, i) => (
                    <div key={i} className="grid grid-cols-[1fr_90px] gap-1">
                      <select className="input input-sm" value={p.method} aria-label="Payment method" onChange={(e) => setPays((ps) => ps.map((x, j) => (j === i ? { ...x, method: e.target.value as PayRow["method"] } : x)))}>
                        <option value="CASH">Cash</option>
                        {props.manualMpesa ? <option value="MPESA">M-Pesa (enter code)</option> : null}
                        <option value="CARD">Card</option>
                        <option value="BANK_TRANSFER">Bank transfer</option>
                        <option value="OTHER">Other</option>
                      </select>
                      <input className="input input-sm text-right" value={p.amount} inputMode="decimal" aria-label="Amount" onChange={(e) => setPays((ps) => ps.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
                      {p.method !== "CASH" ? (
                        <input className="input input-sm col-span-2 uppercase" placeholder={p.method === "MPESA" ? "M-Pesa code from the confirmation SMS" : "Reference"} value={p.reference} aria-label="Reference"
                          onChange={(e) => setPays((ps) => ps.map((x, j) => (j === i ? { ...x, reference: e.target.value.toUpperCase() } : x)))} />
                      ) : null}
                    </div>
                  ))}
                  {pays.length < 4 ? <button className="btn-ghost btn-sm" onClick={() => setPays((ps) => [...ps, { method: props.manualMpesa ? "MPESA" : "CARD", amount: String(Math.max(0, total - paidCents) / 100), reference: "" }])}>Split payment</button> : null}
                  <div className="flex justify-between text-sm"><span>Received</span><span className="tabular-nums">{formatKES(paidCents)}</span></div>
                  {change > 0 ? <div className="flex justify-between text-lg font-semibold text-ok"><span>Change</span><span className="tabular-nums">{formatKES(change)}</span></div> : null}
                  {paidCents < total ? <p className="text-sm text-bad">Short by {formatKES(total - paidCents)}</p> : null}
                  {nonCash > total ? <p className="text-sm text-bad">Only cash can be more than the total.</p> : null}
                  {pays.some((p) => p.method === "MPESA") ? <p className="text-[12px] text-ink-soft">Check the code against the till&apos;s M-Pesa message before completing. Each code can only be used once.</p> : null}
                </>
              ) : (
                <>
                  <input className="input" placeholder="Customer's M-Pesa number" value={stkPhone} onChange={(e) => setStkPhone(e.target.value)} inputMode="tel" aria-label="Customer M-Pesa number" />
                  <p className="text-[12px] text-ink-soft">The items are held while the customer approves on their phone. The sale completes once M-Pesa confirms.</p>
                </>
              )}
              <div className="flex gap-2">
                <button className="btn-secondary" onClick={() => setPaying(false)} disabled={busy}>Back</button>
                <button className="btn-primary flex-1" onClick={complete} disabled={blocked || !payOk}>{busy ? "Working…" : mode === "stk" ? "Send prompt" : "Complete sale"}</button>
              </div>
            </div>
          )}
          {msg ? <p role={msg.ok ? "status" : "alert"} className={`rounded px-3 py-2 text-sm ${msg.ok ? "bg-ok-100 text-ok" : "bg-bad-100 text-bad"}`}>{msg.text}</p> : null}
          {done ? (
            <div className="rounded bg-plum-50 p-3 text-sm">
              <p className="font-semibold">Sale {done.number}{done.changeCents ? ` · change ${formatKES(done.changeCents)}` : ""}</p>
              {done.attemptId ? <p className="text-ink-soft">Waiting for the customer to approve on their phone…</p> : null}
              <div className="mt-2 flex flex-wrap gap-2">
                {done.receiptId ? (
                  <>
                    <a className="btn-primary btn-sm" href={`/documents/${done.receiptId}?format=80`} target="_blank">Print receipt (80 mm)</a>
                    <a className="btn-secondary btn-sm" href={`/documents/${done.receiptId}?format=58`} target="_blank">58 mm</a>
                  </>
                ) : null}
                <Link className="btn-ghost btn-sm" href={`/admin/orders/${done.orderId}`} target="_blank">Open order</Link>
              </div>
            </div>
          ) : null}
          {props.held.length ? (
            <details className="text-sm">
              <summary className="cursor-pointer text-plum">Held sales ({props.held.length})</summary>
              <ul className="mt-2 space-y-1">
                {props.held.map((h) => (
                  <li key={h.id} className="flex items-center justify-between gap-2">
                    <span>{h.label} · {new Date(h.createdAt).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Nairobi" })}</span>
                    <button className="btn-secondary btn-sm" onClick={() => resume(h.id)} disabled={lines.length > 0}>Resume</button>
                  </li>
                ))}
              </ul>
              {lines.length ? <p className="mt-1 text-[12px] text-ink-soft">Finish or hold the current sale first.</p> : null}
            </details>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function CustomerPicker({ customer, setCustomer, search, quick }: { customer: Customer | null; setCustomer: (c: Customer | null) => void; search: Props["actions"]["searchCustomers"]; quick: Props["actions"]["quickCustomer"] }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Customer[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (q.trim().length < 2) return setResults([]);
    const t = setTimeout(async () => setResults(await search(q)), 250);
    return () => clearTimeout(t);
  }, [q, search]);
  if (customer) {
    return (
      <div className="flex items-center justify-between text-sm">
        <span><span className="font-semibold">{customer.name}</span>{customer.phone ? ` · ${customer.phone}` : ""}{customer.isWholesale ? " · wholesale" : ""}</span>
        <button className="btn-ghost btn-sm" onClick={() => setCustomer(null)}>Change</button>
      </div>
    );
  }
  return (
    <div className="space-y-2 text-sm">
      {!creating ? (
        <>
          <div className="flex gap-2">
            <input className="input input-sm" placeholder="Customer (optional): name or phone" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find customer" />
            <button className="btn-secondary btn-sm" onClick={() => { setCreating(true); setName(q); }}>New</button>
          </div>
          {results.length ? (
            <ul className="rounded border border-line">
              {results.map((r) => (
                <li key={r.id}><button className="w-full px-3 py-2 text-left hover:bg-plum-50" onClick={() => { setCustomer(r); setQ(""); }}>{r.name}{r.phone ? ` · ${r.phone}` : ""}</button></li>
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <div className="grid gap-2">
          <input className="input input-sm" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Customer name" />
          <input className="input input-sm" placeholder="Phone (optional)" value={phone} onChange={(e) => setPhone(e.target.value)} aria-label="Customer phone" />
          <div className="flex gap-2">
            <button className="btn-secondary btn-sm" onClick={() => setCreating(false)}>Cancel</button>
            <button className="btn-primary btn-sm" onClick={async () => { const r = await quick(name, phone); if ("error" in r) setErr(r.error); else { setCustomer(r); setCreating(false); setErr(null); } }}>Add customer</button>
          </div>
          {err ? <p className="text-bad">{err}</p> : null}
        </div>
      )}
    </div>
  );
}
