import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireStaffPage } from "@/lib/auth/server";
import { PO_LABEL } from "@/lib/purchasing";
import { Badge, EmptyState, fmtDate, Money, PageHeader } from "@/components/ui";

export const metadata = { title: "Purchase orders" };

export default async function PurchasingPage() {
  await requireStaffPage("purchasing.manage", "/admin/purchasing");
  const rows = await db
    .select({
      po: schema.purchaseOrders,
      supplier: schema.suppliers.name,
      total: sql<number>`(select coalesce(sum(qty_ordered * unit_cost_cents),0)::int from purchase_order_items i where i.po_id = ${schema.purchaseOrders.id})`,
      outstanding: sql<number>`(select coalesce(sum(qty_ordered - qty_received),0)::int from purchase_order_items i where i.po_id = ${schema.purchaseOrders.id})`,
    })
    .from(schema.purchaseOrders)
    .innerJoin(schema.suppliers, eq(schema.suppliers.id, schema.purchaseOrders.supplierId))
    .orderBy(desc(schema.purchaseOrders.createdAt))
    .limit(200);
  return (
    <>
      <PageHeader
        title="Purchase orders"
        description="Order from suppliers and receive deliveries into stock. Receiving updates stock exactly once and keeps your average costs up to date."
        actions={<><Link className="btn-secondary" href="/admin/purchasing/receive">Receive without an order</Link><Link className="btn-primary" href="/admin/purchasing/new">New purchase order</Link></>}
      />
      {rows.length === 0 ? <EmptyState title="No purchase orders yet" action={<Link className="btn-primary" href="/admin/purchasing/new">Create one</Link>}>Add your suppliers first, then raise an order.</EmptyState> : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead><tr><th>Number</th><th>Supplier</th><th>Status</th><th>Created</th><th>Expected</th><th className="text-right">Units outstanding</th><th className="text-right">Value</th></tr></thead>
            <tbody>
              {rows.map(({ po, supplier, total, outstanding }) => (
                <tr key={po.id}>
                  <td><Link className="font-semibold text-plum hover:underline" href={`/admin/purchasing/${po.id}`}>{po.number}</Link></td>
                  <td>{supplier}</td>
                  <td><Badge tone={po.status === "RECEIVED" ? "ok" : po.status === "CANCELLED" ? "neutral" : po.status === "DRAFT" ? "plum" : "warn"}>{PO_LABEL[po.status]}</Badge></td>
                  <td>{fmtDate(po.createdAt)}</td>
                  <td>{fmtDate(po.expectedAt)}{po.expectedAt && po.expectedAt < new Date() && ["ORDERED", "PARTIALLY_RECEIVED"].includes(po.status) ? <Badge tone="bad">Late</Badge> : null}</td>
                  <td className="text-right tabular-nums">{outstanding}</td>
                  <td className="text-right"><Money cents={total} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
