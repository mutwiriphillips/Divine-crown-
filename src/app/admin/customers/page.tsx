import Link from "next/link";
import { db } from "@/db";
import { requireStaffPage } from "@/lib/auth/server";
import { maskEmail, maskPhone } from "@/lib/text";
import { Badge, EmptyState, fmtDate, Money, PageHeader, Pagination } from "@/components/ui";
import { customerStatsSql } from "./query";

export const metadata = { title: "Customers" };
const SEGMENTS = [["", "Everyone"], ["repeat", "Repeat buyers"], ["one", "Bought once"], ["none", "Never bought"], ["lapsed", "No order in 90 days"], ["new", "Joined in 30 days"], ["wholesale", "Wholesale"], ["marketing", "Accept marketing"]];

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; segment?: string; page?: string }> }) {
  const user = await requireStaffPage("customers.view", "/admin/customers");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const res = await db.execute(customerStatsSql({ q: sp.q, segment: sp.segment, limit: 50, offset: (page - 1) * 50 }));
  const rows = res.rows as Record<string, unknown>[];
  const total = rows[0] ? Number(rows[0].total) : 0;
  const seeContact = user.permissions.includes("customers.view_contact");
  const qs = (p: Record<string, string | undefined>) => `?${new URLSearchParams(Object.entries({ ...sp, ...p }).filter(([, v]) => v) as [string, string][])}`;
  return (
    <>
      <PageHeader
        title="Customers"
        description="Lifetime spend is paid orders minus refunds. Contact details are only shown to staff allowed to see them."
        actions={user.permissions.includes("customers.export") ? <a className="btn-secondary" href={`/admin/customers/export${qs({ page: undefined })}`}>Export CSV</a> : null}
      />
      <form className="mb-3 flex flex-wrap gap-2">
        <input className="input input-sm max-w-xs" name="q" defaultValue={sp.q} placeholder="Name, phone or email" aria-label="Search" />
        <select className="input input-sm w-auto" name="segment" defaultValue={sp.segment ?? ""} aria-label="Segment">{SEGMENTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <button className="btn-secondary btn-sm">Show</button>
      </form>
      {rows.length === 0 ? <EmptyState title="No customers found">Customers are added when they order online, register, or are added at the till.</EmptyState> : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead><tr><th>Customer</th><th>Contact</th><th className="text-right">Orders</th><th className="text-right">Lifetime spend</th><th className="text-right">Average order</th><th>Last order</th><th>Joined</th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={String(c.id)}>
                  <td><Link className="font-semibold text-plum hover:underline" href={`/admin/customers/${c.id}`}>{String(c.name)}</Link> {c.is_wholesale ? <Badge tone="clay">Wholesale</Badge> : null}{c.is_demo ? <Badge>Sample</Badge> : null}</td>
                  <td className="text-[13px]">{seeContact ? (c.phone as string) ?? (c.email as string) ?? "—" : maskPhone(c.phone as string) !== "—" ? maskPhone(c.phone as string) : maskEmail(c.email as string)}</td>
                  <td className="text-right tabular-nums">{Number(c.orders)}</td>
                  <td className="text-right"><Money cents={Number(c.spend)} /></td>
                  <td className="text-right">{Number(c.orders) ? <Money cents={Math.round(Number(c.spend) / Number(c.orders))} /> : "—"}</td>
                  <td>{fmtDate(c.last_order as string | null)}</td>
                  <td>{fmtDate(c.created_at as string)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={page} pageSize={50} total={total} hrefFor={(p) => qs({ page: String(p) })} />
    </>
  );
}
