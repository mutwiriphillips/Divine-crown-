import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireStaffPage } from "@/lib/auth/server";
import { PO_LABEL } from "@/lib/purchasing";
import { ActionForm, IdempotencyKey, SubmitButton } from "@/components/forms";
import { Badge, fmtDate, Money, PageHeader } from "@/components/ui";
import { poStatusAction, receiveAction } from "../actions";

export default async function PoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireStaffPage("purchasing.manage", `/admin/purchasing/${id}`);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const po = await db.query.purchaseOrders.findFirst({
    where: eq(schema.purchaseOrders.id, id),
    with: {
      supplier: true,
      location: true,
      items: { with: { variant: { with: { product: true } } }, orderBy: (i) => asc(i.id) },
      receipts: { with: { items: true }, orderBy: (r) => desc(r.receivedAt) },
    },
  });
  if (!po) notFound();
  const total = po.items.reduce((a, i) => a + i.qtyOrdered * i.unitCostCents, 0);
  const open = ["DRAFT", "ORDERED", "PARTIALLY_RECEIVED"].includes(po.status);
  const canReceive = user.permissions.includes("purchasing.receive");
  return (
    <>
      <p className="mb-2 text-sm"><Link className="link" href="/admin/purchasing">Purchase orders</Link></p>
      <PageHeader
        title={po.number}
        description={<span className="flex flex-wrap items-center gap-2"><Badge tone={po.status === "RECEIVED" ? "ok" : "warn"}>{PO_LABEL[po.status]}</Badge> {po.supplier.name} · to {po.location.name} · expected {fmtDate(po.expectedAt)}</span>}
        actions={
          <>
            {po.status === "DRAFT" ? <ActionForm action={poStatusAction}><input type="hidden" name="poId" value={po.id} /><input type="hidden" name="to" value="ORDERED" /><SubmitButton>Mark as sent to supplier</SubmitButton></ActionForm> : null}
            {["DRAFT", "ORDERED"].includes(po.status) ? <ActionForm action={poStatusAction} confirm="Cancel this purchase order?"><input type="hidden" name="poId" value={po.id} /><input type="hidden" name="to" value="CANCELLED" /><SubmitButton className="btn-ghost">Cancel order</SubmitButton></ActionForm> : null}
          </>
        }
      />
      <section className="card mb-6 p-5">
        <table className="table">
          <thead><tr><th>Product</th><th className="text-right">Ordered</th><th className="text-right">Received</th><th className="text-right">Unit cost</th><th className="text-right">Line</th></tr></thead>
          <tbody>
            {po.items.map((i) => (
              <tr key={i.id}><td>{i.variant.product.name} · {i.variant.name}</td><td className="text-right tabular-nums">{i.qtyOrdered}</td><td className="text-right tabular-nums">{i.qtyReceived}</td><td className="text-right"><Money cents={i.unitCostCents} /></td><td className="text-right"><Money cents={i.qtyOrdered * i.unitCostCents} /></td></tr>
            ))}
          </tbody>
          <tfoot><tr><td colSpan={4} className="text-right font-semibold">Total</td><td className="text-right font-semibold"><Money cents={total} /></td></tr></tfoot>
        </table>
        {po.notes ? <p className="mt-3 text-sm text-ink-soft">Notes: {po.notes}</p> : null}
      </section>

      {open && canReceive ? (
        <section className="card mb-6 p-5">
          <h2 className="mb-1 text-lg">Receive delivery</h2>
          <p className="mb-4 text-sm text-ink-soft">Enter what actually arrived. You can receive part of an order now and the rest later. Submitting twice won&apos;t add stock twice.</p>
          <ActionForm action={receiveAction} className="space-y-4">
            <IdempotencyKey />
            <input type="hidden" name="poId" value={po.id} />
            <input type="hidden" name="supplierId" value={po.supplierId} />
            <input type="hidden" name="locationId" value={po.locationId} />
            <table className="table">
              <thead><tr><th>Product</th><th className="w-24">Qty arrived</th><th className="w-32">Cost/unit (KES)</th><th className="w-32">Batch no.</th><th className="w-40">Expiry</th></tr></thead>
              <tbody>
                {po.items.filter((i) => i.qtyReceived < i.qtyOrdered).map((i) => (
                  <tr key={i.id}>
                    <td>{i.variant.product.name} · {i.variant.name}<span className="block text-[12px] text-ink-soft">{i.qtyOrdered - i.qtyReceived} outstanding</span>
                      <input type="hidden" name="poItemId" value={i.id} /><input type="hidden" name="variantId" value={i.variantId} />
                    </td>
                    <td><input className="input input-sm" name="qty" type="number" min={0} max={i.qtyOrdered - i.qtyReceived} defaultValue={i.qtyOrdered - i.qtyReceived} aria-label="Quantity arrived" /></td>
                    <td><input className="input input-sm" name="unitCost" inputMode="decimal" defaultValue={String(i.unitCostCents / 100)} aria-label="Unit cost" /></td>
                    <td><input className="input input-sm" name="batchNo" placeholder={i.variant.trackBatches ? "Required for traceability" : ""} aria-label="Batch number" /></td>
                    <td><input className="input input-sm" name="expiresAt" type="date" aria-label="Expiry date" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="grid gap-3 sm:grid-cols-2">
              <input className="input" name="supplierInvoiceRef" placeholder="Supplier invoice / delivery note number" aria-label="Supplier invoice reference" />
              <input className="input" name="notes" placeholder="Notes (e.g. 2 bottles leaking, returned)" aria-label="Notes" />
            </div>
            <SubmitButton pendingText="Receiving…">Receive into stock</SubmitButton>
          </ActionForm>
        </section>
      ) : null}

      <section className="card p-5">
        <h2 className="mb-3 text-lg">Deliveries received</h2>
        {po.receipts.length === 0 ? <p className="text-sm text-ink-soft">Nothing received yet.</p> : (
          <ul className="space-y-1 text-sm">
            {po.receipts.map((r) => <li key={r.id}>{r.number} · {fmtDate(r.receivedAt, true)} · {r.items.reduce((a, i) => a + i.qty, 0)} units{r.supplierInvoiceRef ? ` · supplier ref ${r.supplierInvoiceRef}` : ""}</li>)}
          </ul>
        )}
        <p className="mt-3 text-sm"><Link className="link" href={`/admin/suppliers/${po.supplierId}`}>Record the supplier&apos;s invoice or a payment</Link></p>
      </section>
    </>
  );
}
