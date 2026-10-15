import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireStaffPage } from "@/lib/auth/server";
import { Badge, EmptyState, Money, PageHeader } from "@/components/ui";

export const metadata = { title: "Stock" };

export default async function InventoryPage({ searchParams }: { searchParams: Promise<{ q?: string; filter?: string }> }) {
  const user = await requireStaffPage("inventory.view", "/admin/inventory");
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const rows = await db.execute<{
    variant_id: string; product_id: string; product: string; variant: string; sku: string | null; status: string;
    on_hand: number; reserved: number; quarantined: number; incoming: number; reorder_level: number; reorder_qty: number; avg_cost: number | null; track: boolean;
  }>(sql`
    select v.id as variant_id, p.id as product_id, p.name as product, v.name as variant, v.sku, p.status,
      coalesce(sum(b.on_hand),0)::int as on_hand, coalesce(sum(b.reserved),0)::int as reserved, coalesce(sum(b.quarantined),0)::int as quarantined,
      coalesce((select sum(i.qty_ordered - i.qty_received) from purchase_order_items i join purchase_orders po on po.id = i.po_id
                where i.variant_id = v.id and po.status in ('ORDERED','PARTIALLY_RECEIVED')),0)::int as incoming,
      v.reorder_level, v.reorder_qty, v.avg_cost_cents as avg_cost, v.track_batches as track
    from product_variants v join products p on p.id = v.product_id left join inventory_balances b on b.variant_id = v.id
    where not v.is_bundle and p.status <> 'ARCHIVED'
      ${q ? sql`and (p.name ilike ${`%${q}%`} or v.sku ilike ${`%${q}%`} or v.barcode = ${q})` : sql``}
    group by v.id, p.id
    ${sp.filter === "low" ? sql`having coalesce(sum(b.on_hand - b.reserved),0) <= v.reorder_level and v.reorder_level > 0` : sp.filter === "out" ? sql`having coalesce(sum(b.on_hand - b.reserved),0) <= 0` : sql``}
    order by p.name, v.name`);
  const canAdjust = user.permissions.includes("inventory.adjust");
  const totals = rows.rows.reduce((a, r) => ({ value: a.value + (r.avg_cost ?? 0) * Number(r.on_hand), unknown: a.unknown + (r.avg_cost == null && Number(r.on_hand) > 0 ? 1 : 0) }), { value: 0, unknown: 0 });
  return (
    <>
      <PageHeader
        title="Stock"
        description="Available = on hand minus units held for unpaid orders. Damaged or expired units are kept apart and never sold."
        actions={
          <>
            <Link className="btn-secondary" href="/admin/inventory/movements">Movement history</Link>
            <Link className="btn-secondary" href="/admin/inventory/reorder">Reorder list</Link>
            {canAdjust ? <Link className="btn-primary" href="/admin/inventory/adjust">Adjust stock</Link> : null}
          </>
        }
      />
      <form className="mb-4 flex flex-wrap gap-2" role="search">
        <input className="input input-sm max-w-xs" name="q" defaultValue={q} placeholder="Product, SKU or barcode" aria-label="Search" />
        <select className="input input-sm w-auto" name="filter" defaultValue={sp.filter ?? ""} aria-label="Show">
          <option value="">All products</option>
          <option value="low">At or below reorder level</option>
          <option value="out">Out of stock</option>
        </select>
        <button className="btn-secondary btn-sm">Show</button>
        <Link className="btn-ghost btn-sm" href="/admin/inventory/locations">Locations</Link>
      </form>
      {rows.rows.length === 0 ? <EmptyState title="Nothing to show">Try a different search or filter.</EmptyState> : (
        <div className="card overflow-x-auto">
          <table className="table [&_td]:align-middle">
            <thead><tr><th>Product</th><th className="text-right">On hand</th><th className="text-right">Held</th><th className="text-right">Available</th><th className="text-right">Damaged/expired</th><th className="text-right">On order</th><th className="text-right">Reorder at</th><th className="text-right">Avg cost</th><th /></tr></thead>
            <tbody>
              {rows.rows.map((r) => {
                const avail = Number(r.on_hand) - Number(r.reserved);
                const low = Number(r.reorder_level) > 0 && avail <= Number(r.reorder_level);
                return (
                  <tr key={r.variant_id}>
                    <td>
                      <Link className="font-semibold text-plum hover:underline" href={`/admin/products/${r.product_id}`}>{r.product}</Link>
                      <span className="block text-[12px] text-ink-soft">{r.variant}{r.sku ? ` · ${r.sku}` : ""}{r.status !== "PUBLISHED" ? " · not in shop" : ""}{r.track ? " · batches" : ""}</span>
                    </td>
                    <td className="text-right tabular-nums">{r.on_hand}</td>
                    <td className="text-right tabular-nums">{r.reserved}</td>
                    <td className="text-right tabular-nums">{avail <= 0 ? <Badge tone="bad">0</Badge> : low ? <Badge tone="warn">{avail}</Badge> : avail}</td>
                    <td className="text-right tabular-nums">{r.quarantined || ""}</td>
                    <td className="text-right tabular-nums">{r.incoming || ""}</td>
                    <td className="text-right tabular-nums">{r.reorder_level || "—"}</td>
                    <td className="text-right">{r.avg_cost != null ? <Money cents={r.avg_cost} /> : <span className="text-ink-faint">—</span>}</td>
                    <td className="whitespace-nowrap text-right">
                      <Link className="link text-sm" href={`/admin/inventory/movements?variant=${r.variant_id}`}>History</Link>
                      {canAdjust ? <> · <Link className="link text-sm" href={`/admin/inventory/adjust?variant=${r.variant_id}`}>Adjust</Link></> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {user.permissions.includes("reports.financial") ? (
        <p className="mt-3 text-sm text-ink-soft">
          Stock value at average cost: <Money cents={totals.value} />.{totals.unknown ? ` ${totals.unknown} product(s) with stock have no recorded cost and are not included.` : ""}
        </p>
      ) : null}
    </>
  );
}
