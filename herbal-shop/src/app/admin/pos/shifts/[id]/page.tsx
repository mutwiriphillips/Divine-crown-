import { notFound } from "next/navigation";
import { asc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireStaffPage } from "@/lib/auth/server";
import { methodLabel } from "@/lib/documents";
import { expectedCash } from "@/lib/pos";
import { fmtDate, Money, PageHeader } from "@/components/ui";
import { PrintButton } from "@/app/documents/[id]/print-button";

const MOVE: Record<string, string> = { OPENING_FLOAT: "Opening float", SALE: "Cash sale", REFUND: "Cash refund", PAY_IN: "Pay in", PAY_OUT: "Pay out", CASH_DROP: "Cash removed" };

/** Shift summary (end-of-day "Z report"). */
export default async function ShiftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireStaffPage("pos.use");
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const s = await db.query.posSessions.findFirst({ where: eq(schema.posSessions.id, id), with: { cashier: true, location: true, cashMovements: { orderBy: (m) => asc(m.createdAt) } } });
  if (!s || (s.cashierId !== user.id && !user.permissions.includes("pos.manage_shifts"))) notFound();
  const [byMethod, sales, refunds] = await Promise.all([
    db.execute<{ method: string; total: number; n: number }>(sql`select method, sum(amount_cents)::int as total, count(*)::int as n from payments where pos_session_id = ${id} and status = 'SUCCEEDED' group by method order by method`),
    db.execute<{ n: number; gross: number; discounts: number; items: number }>(sql`
      select count(*)::int as n, coalesce(sum(total_cents),0)::int as gross, coalesce(sum(discount_cents + (select coalesce(sum(discount_cents),0) from order_items oi where oi.order_id = o.id)),0)::int as discounts,
        coalesce(sum((select sum(qty) from order_items oi where oi.order_id = o.id)),0)::int as items
      from orders o where pos_session_id = ${id} and status not in ('CANCELLED','AWAITING_PAYMENT')`),
    db.execute<{ n: number; total: number }>(sql`select count(*)::int as n, coalesce(sum(amount_cents),0)::int as total from refunds where pos_session_id = ${id}`),
  ]);
  const expected = s.status === "OPEN" ? await expectedCash(id) : s.expectedCashCents ?? 0;
  const sm = sales.rows[0];
  return (
    <>
      <PageHeader title="Shift summary" description={`${s.cashier.name} · ${s.location.name} · ${fmtDate(s.openedAt, true)} – ${s.closedAt ? fmtDate(s.closedAt, true) : "still open"}`} actions={<span className="no-print"><PrintButton /></span>} />
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="mb-3 text-lg">Sales</h2>
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between"><dt>Completed sales</dt><dd>{sm.n}</dd></div>
            <div className="flex justify-between"><dt>Items sold</dt><dd>{sm.items}</dd></div>
            <div className="flex justify-between"><dt>Total sales (after discounts)</dt><dd><Money cents={sm.gross} /></dd></div>
            <div className="flex justify-between"><dt>Discounts given</dt><dd><Money cents={sm.discounts} /></dd></div>
            <div className="flex justify-between"><dt>Refunds from this till ({refunds.rows[0].n})</dt><dd><Money cents={refunds.rows[0].total} /></dd></div>
          </dl>
          <h3 className="mb-2 mt-4 font-semibold">Payments taken</h3>
          <ul className="space-y-1 text-sm">
            {byMethod.rows.map((m) => <li key={m.method} className="flex justify-between"><span>{methodLabel(m.method)} ({m.n})</span><Money cents={Number(m.total)} /></li>)}
            {byMethod.rows.length === 0 ? <li className="text-ink-soft">None.</li> : null}
          </ul>
        </section>
        <section className="card p-5">
          <h2 className="mb-3 text-lg">Cash drawer</h2>
          <ul className="space-y-1 text-sm">
            {s.cashMovements.map((m) => <li key={m.id} className="flex justify-between gap-2"><span>{fmtDate(m.createdAt, true)} · {MOVE[m.type]}{m.reason && m.type !== "SALE" ? ` · ${m.reason}` : ""}</span><Money cents={m.amountCents} /></li>)}
          </ul>
          <dl className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
            <div className="flex justify-between font-semibold"><dt>Expected cash</dt><dd><Money cents={expected} /></dd></div>
            {s.countedCashCents != null ? <div className="flex justify-between"><dt>Counted</dt><dd><Money cents={s.countedCashCents} /></dd></div> : null}
            {s.varianceCents != null ? <div className={`flex justify-between ${s.varianceCents ? "font-semibold text-bad" : "text-ok"}`}><dt>{s.varianceCents > 0 ? "Over" : s.varianceCents < 0 ? "Short" : "Balanced"}</dt><dd><Money cents={s.varianceCents} /></dd></div> : null}
            {s.closingNote ? <p className="text-ink-soft">Note: {s.closingNote}</p> : null}
          </dl>
        </section>
      </div>
    </>
  );
}
