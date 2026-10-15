import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireStaffPage } from "@/lib/auth/server";
import { Badge, EmptyState, fmtDate, PageHeader } from "@/components/ui";

export const metadata = { title: "Support requests" };

export default async function SupportList({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireStaffPage("support.manage", "/admin/support");
  const sp = await searchParams;
  const where = sp.status === "all" ? undefined : sp.status ? eq(schema.supportTickets.status, sp.status as "OPEN") : sql`${schema.supportTickets.status} in ('OPEN','IN_PROGRESS')`;
  const rows = await db.query.supportTickets.findMany({ where, orderBy: [schema.supportTickets.priority, desc(schema.supportTickets.updatedAt)], limit: 200, with: { order: { columns: { number: true } } } });
  return (
    <>
      <PageHeader title="Support requests" description="Questions, complaints, return and cancellation requests from customers." />
      <div className="mb-3 flex gap-2 text-sm">{[["", "Open"], ["RESOLVED", "Resolved"], ["CLOSED", "Closed"], ["all", "All"]].map(([k, l]) => <Link key={k} className="btn-secondary btn-sm" href={k ? `?status=${k}` : "?"}>{l}</Link>)}</div>
      {rows.length === 0 ? <EmptyState title="All caught up">No requests in this list.</EmptyState> : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead><tr><th>Request</th><th>From</th><th>Type</th><th>Order</th><th>Status</th><th>Updated</th></tr></thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id}>
                  <td><Link className="font-semibold text-plum hover:underline" href={`/admin/support/${t.id}`}>{t.subject}</Link><span className="block text-[12px] text-ink-soft">{t.number}{t.priority === 1 ? " · high priority" : ""}</span></td>
                  <td>{t.contactName}</td>
                  <td className="text-[13px]">{t.category.replace(/_/g, " ").toLowerCase()}</td>
                  <td>{t.order?.number ?? "—"}</td>
                  <td><Badge tone={t.status === "OPEN" ? "warn" : t.status === "IN_PROGRESS" ? "plum" : "ok"}>{t.status.replace("_", " ").toLowerCase()}</Badge></td>
                  <td className="whitespace-nowrap">{fmtDate(t.updatedAt, true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
