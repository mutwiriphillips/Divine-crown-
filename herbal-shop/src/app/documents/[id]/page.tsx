import Link from "next/link";
import { notFound } from "next/navigation";
import type { DocSnapshot } from "@/lib/documents";
import { loadDocumentForViewer } from "@/lib/document-access";
import { formatKES } from "@/lib/money";
import { PrintButton } from "./print-button";

export const metadata = { title: "Receipt", robots: { index: false } };

const when = (s: string) => new Date(s).toLocaleString("en-KE", { timeZone: "Africa/Nairobi", dateStyle: "medium", timeStyle: "short" });

export default async function DocumentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ key?: string; format?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const loaded = await loadDocumentForViewer(id, sp.key ?? null);
  if (!loaded) notFound();
  const s = loaded.doc.snapshot as DocSnapshot;
  const format = sp.format === "58" || sp.format === "80" ? sp.format : sp.format === "a4" ? "a4" : loaded.doc.order.source === "POS" ? "80" : "a4";
  const thermal = format !== "a4";
  const width = format === "58" ? "58mm" : format === "80" ? "80mm" : "210mm";
  const q = (f: string) => `?${new URLSearchParams({ ...(sp.key ? { key: sp.key } : {}), format: f }).toString()}`;
  const isCredit = s.kind === "CREDIT_NOTE";

  return (
    <div className="min-h-screen bg-ivory-200 py-6 print:bg-white print:py-0">
      <style>{`@page { size: ${thermal ? `${width} auto` : "A4"}; margin: ${thermal ? "2mm" : "14mm"}; } @media print { .doc { box-shadow: none !important; } }`}</style>
      <div className="no-print mx-auto mb-4 flex max-w-[210mm] flex-wrap items-center gap-2 px-4">
        <PrintButton />
        <a className="btn-secondary btn-sm" href={`/documents/${id}/pdf${sp.key ? `?key=${encodeURIComponent(sp.key)}` : ""}`}>Download PDF</a>
        <span className="ml-2 text-sm text-ink-soft">Layout:</span>
        {[["80", "80 mm till roll"], ["58", "58 mm till roll"], ["a4", "A4"]].map(([f, l]) => (
          <Link key={f} className={`btn-sm btn ${format === f ? "bg-plum text-white" : "btn-ghost"}`} href={q(f)}>{l}</Link>
        ))}
        {loaded.staff && loaded.doc.printCount > 0 ? <span className="text-sm text-ink-soft">Reprint (viewed {loaded.doc.printCount + 1}×)</span> : null}
      </div>
      <article
        className={`doc mx-auto bg-white text-black shadow ${thermal ? "px-3 py-4 font-mono text-[12px] leading-snug" : "px-10 py-10 text-[14px]"}`}
        style={{ width, maxWidth: "100%" }}
      >
        <header className={thermal ? "text-center" : "flex items-start justify-between gap-6"}>
          <div>
            <p className={thermal ? "text-[15px] font-bold" : "font-serif text-3xl text-plum"}>{s.business.name}</p>
            <p>{[s.business.address, s.business.town].filter(Boolean).join(", ")}</p>
            <p>{[s.business.phone, s.business.email].filter(Boolean).join(" · ")}</p>
            {s.business.kraPin ? <p>KRA PIN: {s.business.kraPin}</p> : null}
          </div>
          <div className={thermal ? "mt-2" : "text-right"}>
            <p className={thermal ? "font-bold uppercase" : "text-xl font-semibold"}>{s.title}</p>
            <p>No. {s.number}</p>
            <p>{when(s.issuedAt)}</p>
          </div>
        </header>
        <hr className="my-3 border-dashed border-black/40" />
        <section className={thermal ? "" : "grid grid-cols-2 gap-4"}>
          <p>Order: {s.order.number}{s.order.cashier ? <><br />Served by: {s.order.cashier}</> : null}</p>
          {s.customer && s.customer.name !== "Walk-in customer" ? <p className={thermal ? "" : "text-right"}>Customer: {s.customer.name}{s.customer.phone ? <><br />{s.customer.phone}</> : null}</p> : null}
        </section>
        {isCredit && s.refund ? <p className="mt-2">Refund {s.refund.number} for order {s.order.number}. Reason: {s.refund.reason}</p> : null}
        <table className="mt-3 w-full">
          <thead>
            <tr className="border-b border-black/40 text-left">
              <th className="py-1 font-semibold">Item</th>
              <th className="py-1 text-right font-semibold">Qty</th>
              {!thermal ? <th className="py-1 text-right font-semibold">Unit</th> : null}
              <th className="py-1 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {s.lines.map((l, i) => (
              <tr key={i} className="align-top">
                <td className="py-1 pr-2">
                  {l.name}
                  {l.variant !== "Standard" ? ` (${l.variant})` : ""}
                  {thermal ? <span className="block text-[11px]">@ {formatKES(l.unitCents)}</span> : null}
                  {l.discountCents ? <span className="block text-[11px]">discount −{formatKES(l.discountCents)}</span> : null}
                </td>
                <td className="py-1 text-right">{l.qty}</td>
                {!thermal ? <td className="py-1 text-right">{formatKES(l.unitCents)}</td> : null}
                <td className="whitespace-nowrap py-1 text-right">{formatKES(l.totalCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <hr className="my-2 border-dashed border-black/40" />
        <dl className={`space-y-0.5 ${thermal ? "" : "ml-auto w-72"}`}>
          {!isCredit ? (
            <>
              <Row k="Subtotal" v={s.subtotalCents} />
              {s.discountCents ? <Row k="Discount" v={-s.discountCents} /> : null}
              {s.deliveryFeeCents ? <Row k="Delivery" v={s.deliveryFeeCents} /> : null}
              {s.taxCents && !s.taxInclusive ? <Row k={`VAT ${s.taxRateBp / 100}%`} v={s.taxCents} /> : null}
            </>
          ) : null}
          <Row k={isCredit ? "Refund total" : "Total"} v={s.totalCents} bold />
          {s.taxCents && s.taxInclusive ? <p className="text-[11px]">Includes VAT {s.taxRateBp / 100}%: {formatKES(s.taxCents)}</p> : null}
          {!isCredit ? (
            <>
              {s.payments.map((p, i) => (
                <Row key={i} k={`Paid · ${p.method}${p.reference ? ` ${p.reference}` : ""}`} v={p.amountCents} />
              ))}
              {s.cashTenderedCents ? <Row k="Cash tendered" v={s.cashTenderedCents} /> : null}
              {s.changeCents ? <Row k="Change" v={s.changeCents} /> : null}
              {s.balanceCents ? <Row k="Balance due" v={s.balanceCents} bold /> : null}
            </>
          ) : s.refund ? (
            <p>Refunded by {s.refund.method}{s.refund.status === "PENDING_PAYOUT" ? " (payout pending)" : ""}</p>
          ) : null}
        </dl>
        <hr className="my-3 border-dashed border-black/40" />
        <footer className={`${thermal ? "text-center" : ""} space-y-1 text-[12px]`}>
          {s.note ? <p>{s.note}</p> : null}
          {s.returnPolicy ? <p>{s.returnPolicy}</p> : null}
          {s.footer ? <p>{s.footer}</p> : null}
        </footer>
      </article>
    </div>
  );
}

function Row({ k, v, bold }: { k: string; v: number; bold?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${bold ? "text-[1.1em] font-bold" : ""}`}>
      <dt>{k}</dt>
      <dd className="whitespace-nowrap tabular-nums">{formatKES(v, { showZeroCents: false })}</dd>
    </div>
  );
}
