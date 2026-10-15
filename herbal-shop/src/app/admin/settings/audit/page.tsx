import { and, desc, eq, gte, ilike, lt, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireStaffPage } from "@/lib/auth/server";
import { dateRange } from "@/lib/order-query";
import { fmtDate, PageHeader, Pagination } from "@/components/ui";

export const metadata = { title: "Audit log" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireStaffPage("audit.view", "/admin/settings/audit");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const a = schema.auditLogs;
  const conds: SQL[] = [];
  if (sp.action) conds.push(ilike(a.action, `${sp.action}%`));
  if (sp.user) conds.push(eq(a.userId, sp.user));
  const r = dateRange(sp.from, sp.to);
  if (r.from) conds.push(gte(a.createdAt, r.from));
  if (r.to) conds.push(lt(a.createdAt, r.to));
  const where = conds.length ? and(...conds) : undefined;
  const [rows, count, staff] = await Promise.all([
    db.select({ a, name: schema.users.name }).from(a).leftJoin(schema.users, eq(schema.users.id, a.userId)).where(where).orderBy(desc(a.createdAt)).limit(50).offset((page - 1) * 50),
    db.select({ n: sql<number>`count(*)::int` }).from(a).where(where),
    db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).innerJoin(schema.roles, eq(schema.roles.id, schema.users.roleId)).where(eq(schema.roles.isStaff, true)),
  ]);
  const qs = (p: number) => `?${new URLSearchParams(Object.entries({ ...sp, page: String(p) }).filter(([, v]) => v) as [string, string][])}`;
  return (
    <>
      <PageHeader title="Audit log" description="Sign-ins, price changes, stock adjustments, refunds, permission changes and settings edits. Entries can't be edited or deleted." />
      <form className="mb-4 flex flex-wrap gap-2">
        <select className="input input-sm w-auto" name="action" defaultValue={sp.action ?? ""} aria-label="Type">
          <option value="">All actions</option>
          {["auth.", "price.", "stock.", "refund.", "payment.", "staff.", "role.", "settings.", "product.", "pos.", "privacy.", "order."].map((x) => <option key={x} value={x}>{x.replace(".", "")}</option>)}
        </select>
        <select className="input input-sm w-auto" name="user" defaultValue={sp.user ?? ""} aria-label="Person"><option value="">Everyone</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <input className="input input-sm w-auto" type="date" name="from" defaultValue={sp.from} aria-label="From" />
        <input className="input input-sm w-auto" type="date" name="to" defaultValue={sp.to} aria-label="To" />
        <button className="btn-secondary btn-sm">Filter</button>
      </form>
      <div className="card overflow-x-auto">
        <table className="table">
          <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Details</th><th>IP</th></tr></thead>
          <tbody>
            {rows.map(({ a: x, name }) => (
              <tr key={x.id}>
                <td className="whitespace-nowrap">{fmtDate(x.createdAt, true)}</td>
                <td>{name ?? (x.userId ? "Deleted user" : "System")}</td>
                <td><code className="text-[12px]">{x.action}</code>{x.entityType ? <span className="block text-[12px] text-ink-soft">{x.entityType} {x.entityId?.slice(0, 8)}</span> : null}</td>
                <td className="max-w-[420px] break-words text-[12px] text-ink-soft">{x.details ? JSON.stringify(x.details).slice(0, 300) : ""}</td>
                <td className="text-[12px]">{x.ip ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pageSize={50} total={count[0].n} hrefFor={qs} />
    </>
  );
}
