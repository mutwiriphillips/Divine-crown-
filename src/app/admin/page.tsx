import Link from "next/link";
import { redirect } from "next/navigation";
import { requireStaffPage } from "@/lib/auth/server";
import { unreadStaffAlerts } from "@/lib/notifications";
import { bestsellersInRange, customerGrowth, dailySeries, operationalCounts, presetRange, previousRange, salesSummary } from "@/lib/reports";
import { formatKES } from "@/lib/money";
import { ActionForm, SubmitButton } from "@/components/forms";
import { fmtDate, Money, Notice, PageHeader } from "@/components/ui";
import { ADMIN_NAV } from "./nav";
import { markAlertsReadAction } from "./settings/actions";

const PRESETS = [
  ["today", "Today"],
  ["yesterday", "Yesterday"],
  ["7d", "7 days"],
  ["month", "This month"],
  ["30d", "30 days"],
  ["year", "This year"],
] as const;

function Delta({ now, prev }: { now: number; prev: number }) {
  if (!prev && !now) return <span className="text-ink-faint">no change</span>;
  if (!prev) return <span className="text-ok">new</span>;
  const pct = Math.round(((now - prev) / Math.abs(prev)) * 100);
  return <span className={pct >= 0 ? "text-ok" : "text-bad"}>{pct >= 0 ? "▲" : "▼"} {Math.abs(pct)}% vs previous</span>;
}

function Kpi({ label, value, sub, hint }: { label: string; value: React.ReactNode; sub?: React.ReactNode; hint?: string }) {
  return (
    <div className="card p-4" title={hint}>
      <p className="text-[13px] font-semibold text-ink-soft">{label}</p>
      <p className="mt-1 text-[26px] font-semibold tabular-nums text-ink">{value}</p>
      {sub ? <p className="text-[13px]">{sub}</p> : null}
    </div>
  );
}

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ range?: string; from?: string; to?: string }> }) {
  const user = await requireStaffPage(undefined, "/admin");
  if (!user.permissions.includes("dashboard.view")) {
    const first = ADMIN_NAV.flatMap((g) => g.items).find((i) => i.perm && user.permissions.includes(i.perm));
    redirect(first?.href ?? "/admin/account");
  }
  const sp = await searchParams;
  const range = presetRange(sp.range, sp.from, sp.to);
  const prev = previousRange(range);
  const [now, before, series, ops, best, growth, alerts] = await Promise.all([
    salesSummary(range),
    salesSummary(prev),
    dailySeries(range.to.getTime() - range.from.getTime() <= 86400_000 ? { from: new Date(range.from.getTime() - 13 * 86400_000), to: range.to } : range),
    operationalCounts(),
    bestsellersInRange(range, 8),
    customerGrowth(range),
    unreadStaffAlerts(8),
  ]);
  const fin = user.permissions.includes("reports.financial");
  const max = Math.max(1, ...series.map((s) => s.gross));

  const todo = [
    { n: ops.awaiting_payment, text: `order(s) awaiting payment (${formatKES(Number(ops.awaiting_amount))})`, href: "/admin/orders?status=AWAITING_PAYMENT" },
    { n: ops.to_dispatch, text: "paid order(s) to pack and dispatch", href: "/admin/delivery" },
    { n: ops.to_prepare_collection, text: "paid order(s) to prepare for collection", href: "/admin/orders?status=PAID" },
    { n: ops.out_of_stock, text: "published product(s) out of stock", href: "/admin/inventory?filter=out" },
    { n: ops.low, text: "product(s) at or below reorder level", href: "/admin/inventory/reorder" },
    { n: ops.failed24, text: "failed M-Pesa payment(s) in the last 24 hours", href: "/admin/payments" },
    { n: ops.stuck, text: "M-Pesa request(s) with no answer yet", href: "/admin/payments" },
    { n: ops.refundsPending, text: "refund(s) still to be paid out", href: "/admin/payments?tab=refunds" },
    { n: ops.reviews, text: "review(s) to moderate", href: "/admin/feedback" },
    { n: ops.questions, text: "product question(s) to answer", href: "/admin/feedback?tab=questions" },
    { n: ops.tickets, text: "open support request(s)", href: "/admin/support" },
    { n: ops.products_review, text: "product(s) still marked 'needs review'", href: "/admin/products?review=1" },
  ].filter((t) => Number(t.n) > 0);

  return (
    <>
      <PageHeader title="Overview" description={`${range.label}. All figures come from recorded orders, payments and refunds.`} />
      <form className="mb-5 flex flex-wrap items-center gap-2">
        {PRESETS.map(([k, l]) => (
          <Link key={k} href={`/admin?range=${k}`} className={`btn-sm btn ${range.key === k ? "bg-plum text-white" : "btn-secondary"}`}>{l}</Link>
        ))}
        <input className="input input-sm w-auto" type="date" name="from" defaultValue={sp.from} aria-label="From" />
        <input className="input input-sm w-auto" type="date" name="to" defaultValue={sp.to} aria-label="To" />
        <button className="btn-secondary btn-sm">Apply</button>
      </form>
      {now.demoOrders ? <div className="mb-4"><Notice>Includes {now.demoOrders} order(s) of sample data. Remove sample data before going live.</Notice></div> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Gross sales" value={<Money cents={now.gross} />} sub={<Delta now={now.gross} prev={before.gross} />} hint="Paid and in-progress orders, after discounts, including delivery. Refunds not deducted." />
        <Kpi label="Net sales" value={<Money cents={now.net} />} sub={<span className="text-ink-soft">after <Money cents={now.refunds} /> refunds</span>} hint="Gross sales minus refunds issued in the period." />
        <Kpi label="Orders" value={now.orders} sub={<Delta now={now.orders} prev={before.orders} />} />
        <Kpi label="Average order" value={<Money cents={now.aov} />} sub={<Delta now={now.aov} prev={before.aov} />} />
        {fin ? (
          <Kpi
            label="Gross profit (estimate)"
            value={<Money cents={now.grossProfit} />}
            sub={<span className="text-ink-soft">{now.costCoverage < 1 ? `cost known for ${Math.round(now.costCoverage * 100)}% of items sold` : "cost known for all items"}</span>}
            hint="Merchandise revenue (ex VAT and delivery) minus average cost of items sold. Not net profit."
          />
        ) : null}
        <Kpi label="Discounts given" value={<Money cents={now.discounts} />} />
        <Kpi label="Refunds" value={<Money cents={now.refunds} />} sub={<span className="text-ink-soft">{now.refundCount} refund(s)</span>} />
        <Kpi label="New customers" value={growth.newNow} sub={<Delta now={growth.newNow} prev={growth.newPrev} />} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <section className="card p-5">
          <h2 className="mb-1 text-lg">Daily gross sales</h2>
          <p className="mb-4 text-[13px] text-ink-soft">{series[0]?.day} to {series[series.length - 1]?.day}</p>
          <div className="flex h-44 items-end gap-[3px]" role="img" aria-label="Bar chart of daily gross sales">
            {series.map((s) => (
              <div key={s.day} className="group relative flex-1">
                <div className="w-full rounded-t-sm bg-plum/80 group-hover:bg-clay" style={{ height: `${Math.max(2, (s.gross / max) * 168)}px` }} />
                <span className="pointer-events-none absolute -top-10 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded bg-ink px-2 py-1 text-[12px] text-white group-hover:block">
                  {s.day.slice(5)}: {formatKES(s.gross)} · {s.orders} orders
                </span>
              </div>
            ))}
          </div>
        </section>
        <section className="card p-5">
          <h2 className="mb-3 text-lg">Needs attention</h2>
          {todo.length ? (
            <ul className="space-y-2 text-[15px]">
              {todo.map((t) => (
                <li key={t.href + t.text}>
                  <Link className="flex gap-2 hover:text-plum" href={t.href}>
                    <span className="min-w-8 rounded-sm bg-warn-100 px-2 text-center font-semibold text-warn tabular-nums">{t.n}</span>
                    <span>{t.text}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-ink-soft">Nothing waiting. Good work.</p>
          )}
        </section>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <section className="card p-5">
          <h2 className="mb-3 text-lg">Bestsellers ({range.label.toLowerCase()})</h2>
          {best.length ? (
            <table className="table">
              <thead><tr><th>Product</th><th className="text-right">Units</th><th className="text-right">Sales</th></tr></thead>
              <tbody>{best.map((b) => <tr key={b.name + b.variant}><td>{b.name} <span className="text-ink-soft">· {b.variant}</span></td><td className="text-right tabular-nums">{b.units}</td><td className="text-right"><Money cents={b.revenue} /></td></tr>)}</tbody>
            </table>
          ) : <p className="text-ink-soft">No sales in this period.</p>}
        </section>
        <section className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg">Alerts</h2>
            {alerts.length ? (
              <ActionForm action={markAlertsReadAction}><SubmitButton className="btn-ghost btn-sm">Mark all read</SubmitButton></ActionForm>
            ) : null}
          </div>
          {alerts.length ? (
            <ul className="space-y-2 text-sm">{alerts.map((a) => <li key={a.id} className="border-l-2 border-clay pl-3">{a.body}<span className="block text-[12px] text-ink-soft">{fmtDate(a.createdAt, true)}</span></li>)}</ul>
          ) : <p className="text-ink-soft">No new alerts.</p>}
        </section>
      </div>
      <details className="mt-6 text-[13px] text-ink-soft">
        <summary className="cursor-pointer">How these figures are calculated</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Orders count when paid or in fulfilment; unpaid, awaiting-payment and cancelled orders are left out. Orders are dated by when they were placed (Nairobi time).</li>
          <li>Gross sales include delivery fees and VAT charged, after all discounts. Refunds are shown separately and deducted only in net sales.</li>
          <li>Gross profit = merchandise sales (excluding VAT and delivery) minus the average cost of items sold, for items with a recorded cost. It is not net profit: rent, salaries and other expenses aren&apos;t deducted.</li>
        </ul>
      </details>
    </>
  );
}
