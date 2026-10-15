import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireStaffPage } from "@/lib/auth/server";
import { STATUS_LABEL } from "@/lib/orders";
import { maskEmail, maskPhone } from "@/lib/text";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, fmtDate, Money, ORDER_STATUS_TONE, PageHeader } from "@/components/ui";
import { updateCustomerAction } from "../actions";

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireStaffPage("customers.view", `/admin/customers/${id}`);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const c = await db.query.customers.findFirst({ where: eq(schema.customers.id, id), with: { addresses: true, orders: { orderBy: (o) => desc(o.placedAt), limit: 100 }, reviews: { orderBy: (r) => desc(r.createdAt), limit: 20 } } });
  if (!c) notFound();
  const tickets = await db.query.supportTickets.findMany({ where: eq(schema.supportTickets.customerId, id), orderBy: (t) => desc(t.createdAt), limit: 20 });
  const counted = c.orders.filter((o) => !["CANCELLED", "AWAITING_PAYMENT", "PENDING"].includes(o.status));
  const spend = counted.reduce((a, o) => a + o.totalCents - o.refundedCents, 0);
  const refunded = c.orders.reduce((a, o) => a + o.refundedCents, 0);
  const see = user.permissions.includes("customers.view_contact");
  const canEdit = user.permissions.includes("customers.edit");
  return (
    <>
      <p className="mb-2 text-sm"><Link className="link" href="/admin/customers">Customers</Link></p>
      <PageHeader title={c.name} description={`${see ? c.phone ?? "" : maskPhone(c.phone)} ${see ? c.email ?? "" : maskEmail(c.email)} · customer since ${fmtDate(c.createdAt)}${c.userId ? " · has an account" : " · guest / till"}`} />
      <div className="mb-6 grid gap-3 sm:grid-cols-4">
        <div className="card p-4"><p className="text-[13px] text-ink-soft">Orders</p><p className="text-2xl font-semibold">{counted.length}</p></div>
        <div className="card p-4"><p className="text-[13px] text-ink-soft">Lifetime spend</p><p className="text-2xl font-semibold"><Money cents={spend} /></p></div>
        <div className="card p-4"><p className="text-[13px] text-ink-soft">Average order</p><p className="text-2xl font-semibold"><Money cents={counted.length ? Math.round(spend / counted.length) : 0} /></p></div>
        <div className="card p-4"><p className="text-[13px] text-ink-soft">Refunded</p><p className="text-2xl font-semibold"><Money cents={refunded} /></p></div>
      </div>
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <section className="card p-5">
            <h2 className="mb-3 text-lg">Orders</h2>
            <table className="table">
              <thead><tr><th>Order</th><th>Date</th><th>Status</th><th className="text-right">Total</th></tr></thead>
              <tbody>{c.orders.map((o) => <tr key={o.id}><td><Link className="link" href={`/admin/orders/${o.id}`}>{o.number}</Link></td><td>{fmtDate(o.placedAt)}</td><td><Badge tone={ORDER_STATUS_TONE[o.status]}>{STATUS_LABEL[o.status]}</Badge></td><td className="text-right"><Money cents={o.totalCents} /></td></tr>)}</tbody>
            </table>
          </section>
          <section className="card p-5">
            <h2 className="mb-3 text-lg">Support and feedback</h2>
            <ul className="space-y-1 text-sm">
              {tickets.map((t) => <li key={t.id}><Link className="link" href={`/admin/support/${t.id}`}>{t.number}: {t.subject}</Link> · {t.status.toLowerCase()}</li>)}
              {c.reviews.map((r) => <li key={r.id}>{r.type.toLowerCase()} review: {r.rating}★ · {r.status.toLowerCase()}</li>)}
              {!tickets.length && !c.reviews.length ? <li className="text-ink-soft">None.</li> : null}
            </ul>
          </section>
        </div>
        <aside className="space-y-4">
          <ActionForm action={updateCustomerAction} className="card space-y-3 p-5">
            <input type="hidden" name="id" value={c.id} />
            <label className="field-label" htmlFor="cname">Name</label>
            <input className="input" id="cname" name="name" defaultValue={c.name} disabled={!canEdit} />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="checkbox" name="isWholesale" defaultChecked={c.isWholesale} disabled={!canEdit} /> Wholesale customer</label>
            <label className="field-label" htmlFor="notes">Staff notes</label>
            <textarea className="input" id="notes" name="notes" defaultValue={c.notes ?? ""} disabled={!canEdit} placeholder="Preferences, delivery instructions…" />
            {canEdit ? <SubmitButton>Save</SubmitButton> : null}
          </ActionForm>
          <section className="card p-5 text-sm">
            <h2 className="mb-2 text-lg">Marketing consent</h2>
            <p>Email: {c.marketingEmail ? "yes" : "no"} · SMS: {c.marketingSms ? "yes" : "no"} · WhatsApp: {c.marketingWhatsapp ? "yes" : "no"}</p>
            <p className="text-ink-soft">Last changed {fmtDate(c.consentUpdatedAt, true)}. Only the customer can change this.</p>
          </section>
          {see && c.addresses.length ? (
            <section className="card p-5 text-sm">
              <h2 className="mb-2 text-lg">Addresses</h2>
              <ul className="space-y-1">{c.addresses.map((a) => <li key={a.id}>{[a.street, a.area, a.town, a.county].filter(Boolean).join(", ")}</li>)}</ul>
            </section>
          ) : null}
        </aside>
      </div>
    </>
  );
}
