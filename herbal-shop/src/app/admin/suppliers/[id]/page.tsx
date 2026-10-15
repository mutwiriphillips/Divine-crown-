import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireStaffPage } from "@/lib/auth/server";
import { methodLabel } from "@/lib/documents";
import { PO_LABEL } from "@/lib/purchasing";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, fmtDate, Money, PageHeader } from "@/components/ui";
import { supplierAction, supplierInvoiceAction, supplierPaymentAction } from "../../purchasing/actions";

export default async function SupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireStaffPage("purchasing.manage", `/admin/suppliers/${id}`);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const s = await db.query.suppliers.findFirst({
    where: eq(schema.suppliers.id, id),
    with: { purchaseOrders: { orderBy: (p) => desc(p.createdAt), limit: 30 }, invoices: { orderBy: (i) => desc(i.issuedAt), with: { payments: true } }, payments: { orderBy: (p) => desc(p.paidAt), limit: 50 } },
  });
  if (!s) notFound();
  const perf = await db.execute<{ orders: number; avg_days: number | null; fill: number | null; late: number }>(sql`
    select count(*)::int as orders,
      avg(extract(epoch from (gr.first_received - po.ordered_at)) / 86400)::numeric(6,1) as avg_days,
      (sum(i.received)::float / nullif(sum(i.ordered),0))::numeric(5,2) as fill,
      count(*) filter (where po.expected_at is not null and gr.first_received > po.expected_at + interval '1 day')::int as late
    from purchase_orders po
    left join lateral (select min(received_at) as first_received from goods_receipts g where g.po_id = po.id) gr on true
    left join lateral (select sum(qty_ordered) as ordered, sum(qty_received) as received from purchase_order_items x where x.po_id = po.id) i on true
    where po.supplier_id = ${id} and po.status in ('RECEIVED','PARTIALLY_RECEIVED')`);
  const p = perf.rows[0];
  const invoiced = s.invoices.filter((i) => i.status !== "VOID").reduce((a, i) => a + i.amountCents, 0);
  const paid = s.payments.reduce((a, x) => a + x.amountCents, 0);
  const canPay = user.permissions.includes("purchasing.pay");
  return (
    <>
      <p className="mb-2 text-sm"><Link className="link" href="/admin/suppliers">Suppliers</Link></p>
      <PageHeader title={s.name} description={<>Balance owed: <strong><Money cents={invoiced - paid} /></strong></>} actions={<Link className="btn-primary" href={`/admin/purchasing/new?supplier=${s.id}`}>New purchase order</Link>} />
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <section className="card p-5">
            <h2 className="mb-3 text-lg">Performance</h2>
            {Number(p.orders) ? (
              <p className="text-sm">{p.orders} delivered order(s) · average {p.avg_days ?? "—"} days from order to delivery · {p.fill != null ? `${Math.round(Number(p.fill) * 100)}% of ordered units delivered` : ""} · {p.late} late</p>
            ) : <p className="text-sm text-ink-soft">No deliveries recorded yet.</p>}
          </section>
          <section className="card p-5">
            <h2 className="mb-3 text-lg">Invoices</h2>
            <table className="table">
              <thead><tr><th>Invoice</th><th>Date</th><th>Due</th><th>Status</th><th className="text-right">Amount</th><th className="text-right">Paid</th></tr></thead>
              <tbody>
                {s.invoices.map((i) => {
                  const pd = i.payments.reduce((a, x) => a + x.amountCents, 0);
                  return <tr key={i.id}><td>{i.invoiceRef}</td><td>{fmtDate(i.issuedAt)}</td><td>{fmtDate(i.dueAt)}</td><td><Badge tone={i.status === "PAID" ? "ok" : "warn"}>{i.status.replace("_", " ").toLowerCase()}</Badge></td><td className="text-right"><Money cents={i.amountCents} /></td><td className="text-right"><Money cents={pd} /></td></tr>;
                })}
              </tbody>
            </table>
            {canPay ? (
              <ActionForm action={supplierInvoiceAction} className="mt-4 grid gap-2 sm:grid-cols-3" resetOnSuccess>
                <input type="hidden" name="supplierId" value={s.id} />
                <input className="input input-sm" name="invoiceRef" placeholder="Invoice number" required aria-label="Invoice number" />
                <input className="input input-sm" name="amount" inputMode="decimal" placeholder="Amount (KES)" required aria-label="Amount" />
                <select className="input input-sm" name="poId" defaultValue="" aria-label="Purchase order"><option value="">No PO</option>{s.purchaseOrders.map((po) => <option key={po.id} value={po.id}>{po.number}</option>)}</select>
                <input className="input input-sm" name="issuedAt" type="date" aria-label="Invoice date" />
                <input className="input input-sm" name="dueAt" type="date" aria-label="Due date" />
                <SubmitButton className="btn-secondary btn-sm">Record invoice</SubmitButton>
              </ActionForm>
            ) : null}
          </section>
          <section className="card p-5">
            <h2 className="mb-3 text-lg">Payments made</h2>
            <ul className="space-y-1 text-sm">
              {s.payments.map((x) => <li key={x.id} className="flex justify-between"><span>{fmtDate(x.paidAt)} · {methodLabel(x.method)}{x.reference ? ` · ${x.reference}` : ""}</span><Money cents={x.amountCents} /></li>)}
              {s.payments.length === 0 ? <li className="text-ink-soft">None yet.</li> : null}
            </ul>
            {canPay ? (
              <ActionForm action={supplierPaymentAction} className="mt-4 grid gap-2 sm:grid-cols-3" resetOnSuccess>
                <input type="hidden" name="supplierId" value={s.id} />
                <input className="input input-sm" name="amount" inputMode="decimal" placeholder="Amount (KES)" required aria-label="Amount" />
                <select className="input input-sm" name="method" defaultValue="MPESA" aria-label="Method"><option value="MPESA">M-Pesa</option><option value="BANK_TRANSFER">Bank transfer</option><option value="CASH">Cash</option><option value="OTHER">Other</option></select>
                <input className="input input-sm" name="reference" placeholder="Reference" aria-label="Reference" />
                <select className="input input-sm" name="invoiceId" defaultValue="" aria-label="Invoice"><option value="">Not linked to an invoice</option>{s.invoices.filter((i) => i.status !== "PAID").map((i) => <option key={i.id} value={i.id}>{i.invoiceRef}</option>)}</select>
                <input className="input input-sm" name="paidAt" type="date" aria-label="Date paid" />
                <SubmitButton className="btn-secondary btn-sm">Record payment</SubmitButton>
              </ActionForm>
            ) : null}
          </section>
          <section className="card p-5">
            <h2 className="mb-3 text-lg">Purchase orders</h2>
            <ul className="space-y-1 text-sm">{s.purchaseOrders.map((po) => <li key={po.id}><Link className="link" href={`/admin/purchasing/${po.id}`}>{po.number}</Link> · {PO_LABEL[po.status]} · {fmtDate(po.createdAt)}</li>)}</ul>
          </section>
        </div>
        <ActionForm action={supplierAction} className="card h-fit space-y-3 p-5">
          <h2 className="text-lg">Details</h2>
          <input type="hidden" name="id" value={s.id} />
          <input className="input" name="name" defaultValue={s.name} required aria-label="Name" />
          <input className="input" name="contactName" defaultValue={s.contactName ?? ""} placeholder="Contact person" aria-label="Contact person" />
          <input className="input" name="phone" defaultValue={s.phone ?? ""} placeholder="Phone" aria-label="Phone" />
          <input className="input" name="email" defaultValue={s.email ?? ""} placeholder="Email" aria-label="Email" />
          <input className="input" name="address" defaultValue={s.address ?? ""} placeholder="Address" aria-label="Address" />
          <textarea className="input" name="notes" defaultValue={s.notes ?? ""} placeholder="Notes" aria-label="Notes" />
          <select className="input" name="isActive" defaultValue={s.isActive ? "on" : "off"} aria-label="Status"><option value="on">Active</option><option value="off">Inactive</option></select>
          <SubmitButton>Save</SubmitButton>
        </ActionForm>
      </div>
    </>
  );
}
