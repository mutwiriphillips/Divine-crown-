import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireStaffPage } from "@/lib/auth/server";
import { Badge, fmtDate, Money, PageHeader } from "@/components/ui";

export const metadata = { title: "Till shifts" };

export default async function ShiftsPage() {
  const user = await requireStaffPage("pos.use", "/admin/pos/shifts");
  const all = user.permissions.includes("pos.manage_shifts");
  const rows = await db.query.posSessions.findMany({
    where: all ? undefined : eq(schema.posSessions.cashierId, user.id),
    orderBy: desc(schema.posSessions.openedAt),
    limit: 100,
    with: { cashier: { columns: { name: true } }, location: { columns: { name: true } } },
  });
  return (
    <>
      <PageHeader title="Till shifts" description={all ? "All cashiers' shifts." : "Your shifts."} />
      <div className="card overflow-x-auto">
        <table className="table">
          <thead><tr><th>Opened</th><th>Cashier</th><th>Shop</th><th>Status</th><th className="text-right">Float</th><th className="text-right">Expected</th><th className="text-right">Counted</th><th className="text-right">Difference</th></tr></thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id}>
                <td><Link className="link" href={`/admin/pos/shifts/${s.id}`}>{fmtDate(s.openedAt, true)}</Link></td>
                <td>{s.cashier.name}</td>
                <td>{s.location.name}</td>
                <td>{s.status === "OPEN" ? <Badge tone="warn">Open</Badge> : <Badge tone="ok">Closed {fmtDate(s.closedAt, true)}</Badge>}</td>
                <td className="text-right"><Money cents={s.openingFloatCents} /></td>
                <td className="text-right">{s.expectedCashCents != null ? <Money cents={s.expectedCashCents} /> : "—"}</td>
                <td className="text-right">{s.countedCashCents != null ? <Money cents={s.countedCashCents} /> : "—"}</td>
                <td className={`text-right ${s.varianceCents ? "font-semibold text-bad" : ""}`}>{s.varianceCents != null ? <Money cents={s.varianceCents} /> : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
