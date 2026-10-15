import Link from "next/link";
import { requireStaffPage } from "@/lib/auth/server";
import { formatKES } from "@/lib/money";
import { findReport, REPORTS, type Col } from "@/lib/report-defs";
import { presetRange } from "@/lib/reports";
import { EmptyState, Notice, PageHeader } from "@/components/ui";
import { PrintButton } from "./print-button";

export const metadata = { title: "Reports" };

const PRESETS = [["today", "Today"], ["yesterday", "Yesterday"], ["7d", "7 days"], ["month", "This month"], ["30d", "30 days"], ["year", "This year"]] as const;

function cell(c: Col, v: unknown) {
  if (v === null || v === undefined || v === "") return <span className="text-ink-faint">—</span>;
  switch (c.kind) {
    case "money": return formatKES(Number(v));
    case "int": return Number(v).toLocaleString("en-KE");
    case "pct": return `${(Number(v) * 100).toFixed(1)}%`;
    default: return String(v);
  }
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireStaffPage("reports.sales", "/admin/reports");
  const sp = await searchParams;
  const allowed = REPORTS.filter((r) => user.permissions.includes(r.perm));
  const def = findReport(sp.report) && allowed.includes(findReport(sp.report)!) ? findReport(sp.report)! : allowed[0];
  const range = presetRange(sp.range ?? "month", sp.from, sp.to);
  const opts = def.options ? { [def.options.name]: sp[def.options.name] } : {};
  const result = await def.run(range, opts);

  const keep = (extra: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    const merged = { report: def.key, range: sp.from && sp.to ? undefined : range.key, from: sp.from, to: sp.to, ...opts, ...extra };
    for (const [k, v] of Object.entries(merged)) if (v) q.set(k, v);
    return `?${q.toString()}`;
  };
  const groups = [...new Set(allowed.map((r) => r.group))];
  const numeric = (c: Col) => c.kind !== "text";

  return (
    <>
      <div className="print:hidden">
        <PageHeader title="Reports" description="Figures come from recorded orders, payments, refunds, stock movements and expenses. Export any report as CSV for your accountant." />
      </div>
      <div className="grid gap-6 lg:grid-cols-[230px_1fr]">
        <form className="flex gap-2 lg:hidden print:hidden">
          <input type="hidden" name="range" value={range.key === "custom" ? "month" : range.key} />
          <select className="input" name="report" defaultValue={def.key} aria-label="Choose a report">
            {groups.map((g) => (
              <optgroup key={g} label={g}>{allowed.filter((r) => r.group === g).map((r) => <option key={r.key} value={r.key}>{r.title}</option>)}</optgroup>
            ))}
          </select>
          <button className="btn-secondary">Show</button>
        </form>
        <nav className="hidden space-y-4 lg:block print:hidden" aria-label="Reports">
          {groups.map((g) => (
            <div key={g}>
              <p className="mb-1 text-[13px] font-semibold text-ink-soft">{g}</p>
              <ul className="space-y-0.5">
                {allowed.filter((r) => r.group === g).map((r) => (
                  <li key={r.key}>
                    <Link href={`?report=${r.key}&range=${range.key === "custom" ? "month" : range.key}`} aria-current={r.key === def.key ? "page" : undefined}
                      className={`block rounded px-2 py-1 text-[15px] ${r.key === def.key ? "bg-plum text-white" : "hover:bg-plum/5"}`}>{r.title}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <section className="min-w-0">
          <div className="mb-4">
            <h2 className="text-2xl">{def.title}</h2>
            <p className="text-ink-soft">{def.description}</p>
            <p className="mt-1 hidden text-sm print:block">{def.usesRange ? range.label : "Snapshot"} · printed {new Date().toLocaleString("en-KE", { timeZone: "Africa/Nairobi" })}</p>
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
            {def.usesRange ? (
              <>
                {PRESETS.map(([k, l]) => (
                  <Link key={k} href={keep({ range: k, from: undefined, to: undefined })} className={`btn btn-sm ${range.key === k ? "bg-plum text-white" : "btn-secondary"}`}>{l}</Link>
                ))}
                <form className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="report" value={def.key} />
                  {def.options ? <input type="hidden" name={def.options.name} value={opts[def.options.name] ?? ""} /> : null}
                  <input className="input input-sm w-auto" type="date" name="from" defaultValue={sp.from} aria-label="From" required />
                  <input className="input input-sm w-auto" type="date" name="to" defaultValue={sp.to} aria-label="To" required />
                  <button className="btn-secondary btn-sm">Apply dates</button>
                </form>
              </>
            ) : <span className="text-sm text-ink-soft">Current position — not affected by dates.</span>}
            <span className="grow" />
            <a className="btn-secondary btn-sm" href={`/admin/reports/export${keep({})}`}>Download CSV</a>
            <PrintButton />
          </div>

          {def.options ? (
            <div className="mb-4 flex flex-wrap gap-2 print:hidden" role="group" aria-label={def.options.label}>
              <span className="self-center text-sm text-ink-soft">{def.options.label}:</span>
              {def.options.values.map(([v, l]) => {
                const active = (opts[def.options!.name] ?? def.options!.values[0][0]) === v;
                return <Link key={v} href={keep({ [def.options!.name]: v })} className={`btn btn-sm ${active ? "bg-clay text-white" : "btn-ghost"}`}>{l}</Link>;
              })}
            </div>
          ) : null}

          {def.usesRange ? <p className="mb-3 text-sm font-semibold print:hidden">{range.label}</p> : null}

          {result.rows.length ? (
            <div className="card overflow-x-auto print:border-0 print:shadow-none">
              <table className="table text-[14px]">
                <thead>
                  <tr>{result.columns.map((c) => <th key={c.key} className={numeric(c) ? "text-right" : ""}>{c.label}</th>)}</tr>
                </thead>
                <tbody>
                  {result.rows.map((row, idx) => (
                    <tr key={idx}>{result.columns.map((c) => <td key={c.key} className={numeric(c) ? "whitespace-nowrap text-right tabular-nums" : ""}>{cell(c, row[c.key])}</td>)}</tr>
                  ))}
                </tbody>
                {result.totals ? (
                  <tfoot>
                    <tr className="border-t-2 border-ink font-semibold">{result.columns.map((c) => <td key={c.key} className={numeric(c) ? "whitespace-nowrap text-right tabular-nums" : ""}>{c.key in result.totals! ? cell(c, result.totals![c.key]) : ""}</td>)}</tr>
                  </tfoot>
                ) : null}
              </table>
            </div>
          ) : (
            <EmptyState title="Nothing to show">{def.usesRange ? "No records in this period. Try a wider date range." : "There's nothing to report right now."}</EmptyState>
          )}

          {result.notes?.length ? (
            <div className="mt-4 space-y-2">{result.notes.map((n) => <Notice key={n} tone="plum">{n}</Notice>)}</div>
          ) : null}
        </section>
      </div>
    </>
  );
}
