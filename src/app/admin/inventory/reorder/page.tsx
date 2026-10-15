import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireStaffPage } from "@/lib/auth/server";
import { EmptyState, Money, PageHeader } from "@/components/ui";

export const metadata = { title: "Reorder list" };

/**
 * Suggested reorder = enough to get back to (reorder level + usual reorder quantity), minus what's already on order.
 * Products without a reorder level are not included.
 */
export default async function ReorderPage() {
  const user = await requireStaffPage("inventory.view", "/admin/inventory/reorder");
  const r = await db.execute<{ variant_id: string; product: string; variant: string; supplier_id: string | null; supplier: string | null; avail: number; level: number; reorder_qty: number; incoming: number; cost: number | null; sold30: number }>(sql`
    select v.id as variant_id, p.name as product, v.name as variant, p.default_supplier_id as supplier_id, s.name as supplier,
      coalesce((select sum(on_hand - reserved) from inventory_balances b where b.variant_id = v.id),0)::int as avail,
      v.reorder_level as level, v.reorder_qty,
      coalesce((select sum(i.qty_ordered - i.qty_received) from purchase_order_items i join purchase_orders po on po.id = i.po_id where i.variant_id = v.id and po.status in ('ORDERED','PARTIALLY_RECEIVED','DRAFT')),0)::int as incoming,
      v.avg_cost_cents as cost,
      coalesce((select sum(-m.on_hand_delta) from stock_movements m where m.variant_id = v.id and m.type = 'SALE' and m.created_at > now() - interval '30 days'),0)::int as sold30
    from product_variants v join products p on p.id = v.product_id left join suppliers s on s.id = p.default_supplier_id
    where v.is_active and not v.is_bundle and p.status <> 'ARCHIVED' and v.reorder_level > 0
      and coalesce((select sum(on_hand - reserved) from inventory_balances b where b.variant_id = v.id),0) <= v.reorder_level
    order by s.name nulls last, p.name`);
  const rows = r.rows.map((x) => ({ ...x, suggest: Math.max(0, Number(x.level) + Math.max(Number(x.reorder_qty), 1) - Number(x.avail) - Number(x.incoming)) }));
  const groups = new Map<string, typeof rows>();
  for (const x of rows) groups.set(x.supplier_id ?? "", [...(groups.get(x.supplier_id ?? "") ?? []), x]);
  const canPo = user.permissions.includes("purchasing.manage");
  return (
    <>
      <PageHeader title="Reorder list" description="Products at or below their reorder level. Suggested quantities top stock back up to the reorder level plus the usual order size, minus anything already on order." />
      {rows.length === 0 ? <EmptyState title="Nothing needs reordering">Set a reorder level on each product variant to get alerts here.</EmptyState> : null}
      {[...groups.entries()].map(([sid, items]) => (
        <section key={sid || "none"} className="card mb-6 p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg">{items[0].supplier ?? "No usual supplier set"}</h2>
            {canPo && sid ? (
              <Link className="btn-primary btn-sm" href={`/admin/purchasing/new?supplier=${sid}&items=${encodeURIComponent(items.filter((i) => i.suggest > 0).map((i) => `${i.variant_id}:${i.suggest}`).join(","))}`}>
                Draft a purchase order
              </Link>
            ) : null}
          </div>
          <table className="table">
            <thead><tr><th>Product</th><th className="text-right">Available</th><th className="text-right">Reorder at</th><th className="text-right">On order</th><th className="text-right">Sold (30 days)</th><th className="text-right">Suggested</th><th className="text-right">Last cost</th></tr></thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.variant_id}>
                  <td>{i.product} · {i.variant}</td>
                  <td className="text-right tabular-nums">{i.avail}</td>
                  <td className="text-right tabular-nums">{i.level}</td>
                  <td className="text-right tabular-nums">{i.incoming || ""}</td>
                  <td className="text-right tabular-nums">{i.sold30}</td>
                  <td className="text-right font-semibold tabular-nums">{i.suggest}</td>
                  <td className="text-right">{i.cost != null ? <Money cents={i.cost} /> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </>
  );
}
