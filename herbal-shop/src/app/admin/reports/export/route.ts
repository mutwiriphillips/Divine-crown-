import { getCurrentUser } from "@/lib/auth/server";
import { csvResponse, toCsv } from "@/lib/csv";
import { centsToDecimalString } from "@/lib/money";
import { findReport } from "@/lib/report-defs";
import { presetRange } from "@/lib/reports";
import { audit } from "@/lib/audit";

export async function GET(req: Request) {
  const u = await getCurrentUser();
  const sp = Object.fromEntries(new URL(req.url).searchParams.entries());
  const def = findReport(sp.report);
  if (!def) return new Response("Unknown report", { status: 404 });
  if (!u?.isStaff || !u.permissions.includes(def.perm)) return new Response("Forbidden", { status: 403 });
  const range = presetRange(sp.range ?? "month", sp.from, sp.to);
  const result = await def.run(range, def.options ? { [def.options.name]: sp[def.options.name] } : {});
  const header = result.columns.map((c) => (c.kind === "money" ? `${c.label} (KES)` : c.kind === "pct" ? `${c.label} (%)` : c.label));
  const fmt = (kind: string, v: unknown) =>
    v === null || v === undefined || v === "" ? "" : kind === "money" ? centsToDecimalString(Number(v)) : kind === "pct" ? (Number(v) * 100).toFixed(1) : v;
  const toRow = (r: Record<string, unknown>) => Object.fromEntries(result.columns.map((c, i) => [header[i], fmt(c.kind, r[c.key])]));
  const data = result.rows.map(toRow);
  if (result.totals) data.push(toRow(result.totals));
  await audit({ userId: u.id, action: "report.export", entityType: "report", entityId: def.key, details: { from: range.from.toISOString(), to: range.to.toISOString() } }).catch(() => {});
  const stamp = def.usesRange ? `${range.from.toISOString().slice(0, 10)}_${new Date(range.to.getTime() - 1).toISOString().slice(0, 10)}` : new Date().toISOString().slice(0, 10);
  return csvResponse(`${def.key}-${stamp}.csv`, toCsv(data, header));
}
