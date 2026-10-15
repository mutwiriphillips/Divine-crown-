import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireStaffPage } from "@/lib/auth/server";
import { formatKES } from "@/lib/money";
import { STATUS_LABEL } from "@/lib/orders";
import { getSetting } from "@/lib/settings";
import { PrintButton } from "@/app/documents/[id]/print-button";

/** Packing / order summary for staff. Not a receipt. */
export default async function OrderPrint({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireStaffPage("orders.view");
  const o = await db.query.orders.findFirst({ where: eq(schema.orders.id, id), with: { items: true, zone: true } });
  if (!o) notFound();
  const b = await getSetting("business");
  const addr = o.deliveryAddress as Record<string, string> | null;
  return (
    <div className="fixed inset-0 z-50 overflow-auto bg-white p-8 text-black">
      <div className="no-print mb-4"><PrintButton /></div>
      <h1 className="font-serif text-2xl">{b.name} — order summary</h1>
      <p className="mt-1">Order {o.number} · {o.placedAt.toLocaleString("en-KE", { timeZone: "Africa/Nairobi" })} · {STATUS_LABEL[o.status]}</p>
      <p className="mt-3"><strong>{o.contactName}</strong> · {o.contactPhone}</p>
      {addr ? <p>{[addr.street, addr.area, addr.town, addr.county].filter(Boolean).join(", ")} {addr.landmark ? `— ${addr.landmark}` : ""}</p> : <p>Collection from shop</p>}
      {o.zone ? <p>Delivery area: {o.zone.name}</p> : null}
      {o.notes ? <p className="mt-2">Customer note: {o.notes}</p> : null}
      <table className="mt-4 w-full border-collapse text-sm">
        <thead><tr className="border-b border-black text-left"><th className="py-1">Packed</th><th>Item</th><th>SKU</th><th className="text-right">Qty</th></tr></thead>
        <tbody>
          {o.items.map((i) => (
            <tr key={i.id} className="border-b border-black/20"><td className="py-2">☐</td><td>{i.productName} · {i.variantName}</td><td>{i.sku ?? ""}</td><td className="text-right">{i.qty}</td></tr>
          ))}
        </tbody>
      </table>
      <p className="mt-4">Total {formatKES(o.totalCents)} · Paid {formatKES(o.amountPaidCents)}{o.totalCents > o.amountPaidCents ? ` · COLLECT ${formatKES(o.totalCents - o.amountPaidCents)}` : ""}</p>
    </div>
  );
}
