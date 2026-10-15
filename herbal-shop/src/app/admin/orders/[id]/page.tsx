import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireStaffPage } from "@/lib/auth/server";
import { methodLabel } from "@/lib/documents";
import { PAYMENT_STATUS_LABEL, STATUS_LABEL, TRANSITIONS } from "@/lib/orders";
import { maskEmail, maskPhone } from "@/lib/text";
import { Badge, fmtDate, Money, Notice, ORDER_STATUS_TONE, PageHeader } from "@/components/ui";
import { ActionForm, IdempotencyKey, SubmitButton } from "@/components/forms";
import {
  addNoteAction,
  assignOrderAction,
  changeStatusAction,
  deliveryAction,
  issueInvoiceAction,
  recordManualPaymentAction,
  refundAction,
  refundPaidOutAction,
} from "../actions";

export default async function AdminOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireStaffPage("orders.view", `/admin/orders/${id}`);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const o = await db.query.orders.findFirst({
    where: eq(schema.orders.id, id),
    with: {
      items: true,
      payments: { orderBy: (p) => asc(p.receivedAt) },
      attempts: { orderBy: (a) => desc(a.createdAt) },
      refunds: { orderBy: (r) => asc(r.createdAt), with: { items: true } },
      documents: true,
      events: { orderBy: (e) => desc(e.createdAt) },
      delivery: true,
      zone: true,
      customer: true,
    },
  });
  if (!o) notFound();
  const [staff, myShift] = await Promise.all([
    db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).innerJoin(schema.roles, eq(schema.roles.id, schema.users.roleId)).where(and(eq(schema.roles.isStaff, true), eq(schema.users.status, "ACTIVE"))),
    db.query.posSessions.findFirst({ where: and(eq(schema.posSessions.cashierId, user.id), eq(schema.posSessions.status, "OPEN")) }),
  ]);
  const can = (p: string) => user.permissions.includes(p);
  const seeContact = can("customers.view_contact");
  const allowed = (TRANSITIONS[o.status] ?? []).filter((s) => (s === "CANCELLED" ? can("orders.cancel") : can("orders.manage")));
  const due = o.totalCents - o.amountPaidCents;
  const refundable = o.amountPaidCents - o.refundedCents;
  const addr = o.deliveryAddress as Record<string, string> | null;
  const userName = (uid: string | null) => staff.find((s) => s.id === uid)?.name ?? (uid ? "Staff" : "System");

  return (
    <>
      <p className="mb-2 text-sm"><Link className="link" href="/admin/orders">Orders</Link></p>
      <PageHeader
        title={`Order ${o.number}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={ORDER_STATUS_TONE[o.status]}>{STATUS_LABEL[o.status]}</Badge>
            <Badge tone={ORDER_STATUS_TONE[o.paymentStatus] ?? "neutral"}>{PAYMENT_STATUS_LABEL[o.paymentStatus]}</Badge>
            <span>{o.source === "POS" ? "Till sale" : o.source === "ONLINE" ? "Online" : "Manual"} · {fmtDate(o.placedAt, true)}</span>
            {o.isDemo ? <Badge>Sample data</Badge> : null}
          </span>
        }
        actions={<Link className="btn-secondary" href={`/admin/orders/${o.id}/print`} target="_blank">Print order summary</Link>}
      />
      {o.stockState === "RESERVED" && o.status === "AWAITING_PAYMENT" ? (
        <div className="mb-4"><Notice>Stock is held for this order until {fmtDate(o.reservationExpiresAt, true)}. If it isn&apos;t paid by then, it&apos;s cancelled automatically and the stock is released.</Notice></div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <section className="card p-5">
            <h2 className="mb-3 text-lg">Items</h2>
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th>Product</th><th>SKU</th><th className="text-right">Qty</th><th className="text-right">Unit</th><th className="text-right">Total</th></tr></thead>
                <tbody>
                  {o.items.map((i) => (
                    <tr key={i.id}>
                      <td>{i.productName} <span className="text-ink-soft">· {i.variantName}</span>
                        {i.unitPriceCents !== i.listPriceCents ? <span className="block text-[12px] text-warn">{i.priceOverriddenById ? "Price changed at till" : "Wholesale price"} (list <Money cents={i.listPriceCents} />)</span> : null}
                        {i.qtyRefunded ? <span className="block text-[12px] text-clay-700">{i.qtyRefunded} refunded</span> : null}
                      </td>
                      <td>{i.sku ?? "—"}</td>
                      <td className="text-right tabular-nums">{i.qty}</td>
                      <td className="text-right"><Money cents={i.unitPriceCents} /></td>
                      <td className="text-right"><Money cents={i.lineTotalCents} />{i.discountCents ? <span className="block text-[12px] text-ok">−<Money cents={i.discountCents} /></span> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <dl className="ml-auto mt-3 w-full max-w-xs space-y-1 text-sm">
              <div className="flex justify-between"><dt>Subtotal</dt><dd><Money cents={o.subtotalCents} /></dd></div>
              {o.discountCents ? <div className="flex justify-between"><dt>Order discount{o.couponCode ? ` (${o.couponCode})` : ""}</dt><dd>−<Money cents={o.discountCents} /></dd></div> : null}
              {o.deliveryFeeCents ? <div className="flex justify-between"><dt>Delivery</dt><dd><Money cents={o.deliveryFeeCents} /></dd></div> : null}
              {o.taxCents ? <div className="flex justify-between text-ink-soft"><dt>VAT {o.taxInclusive ? "(included)" : ""}</dt><dd><Money cents={o.taxCents} /></dd></div> : null}
              <div className="flex justify-between border-t border-line pt-1 text-base font-semibold"><dt>Total</dt><dd><Money cents={o.totalCents} /></dd></div>
              <div className="flex justify-between"><dt>Paid</dt><dd><Money cents={o.amountPaidCents} /></dd></div>
              {o.refundedCents ? <div className="flex justify-between text-clay-700"><dt>Refunded</dt><dd><Money cents={o.refundedCents} /></dd></div> : null}
              {due > 0 && o.status !== "CANCELLED" ? <div className="flex justify-between font-semibold text-warn"><dt>Balance due</dt><dd><Money cents={due} /></dd></div> : null}
            </dl>
          </section>

          <section className="card p-5">
            <h2 className="mb-3 text-lg">Payments</h2>
            {o.payments.length === 0 ? <p className="text-sm text-ink-soft">No payments recorded.</p> : (
              <ul className="space-y-1 text-sm">
                {o.payments.map((p) => (
                  <li key={p.id} className="flex flex-wrap justify-between gap-2">
                    <span>{methodLabel(p.method)}{p.reference ? ` · ${p.reference}` : ""} · {fmtDate(p.receivedAt, true)}{p.recordedById ? ` · recorded by ${userName(p.recordedById)}` : " · confirmed by M-Pesa"}{p.note ? ` · ${p.note}` : ""}</span>
                    <Money cents={p.amountCents} />
                  </li>
                ))}
              </ul>
            )}
            {o.attempts.length ? (
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer text-ink-soft">M-Pesa requests ({o.attempts.length})</summary>
                <ul className="mt-2 space-y-1">
                  {o.attempts.map((a) => (
                    <li key={a.id}>{fmtDate(a.createdAt, true)} · {maskPhone(a.phone)} · <Money cents={a.amountCents} /> · <strong>{a.status.toLowerCase()}</strong>{a.resultDesc ? ` — ${a.resultDesc}` : ""}{a.providerReceipt ? ` · ${a.providerReceipt}` : ""}</li>
                  ))}
                </ul>
              </details>
            ) : null}
            {can("payments.record") && due > 0 && !["CANCELLED", "REFUNDED"].includes(o.status) ? (
              <details className="mt-4 rounded border border-line bg-white p-4">
                <summary className="cursor-pointer font-semibold">Record a payment received</summary>
                <p className="mt-2 text-[13px] text-ink-soft">Only record money you&apos;ve actually received — check your M-Pesa statement or till. Screenshots aren&apos;t proof of payment.</p>
                <ActionForm action={recordManualPaymentAction} className="mt-3 grid gap-3 sm:grid-cols-2">
                  <input type="hidden" name="orderId" value={o.id} />
                  <select className="input input-sm" name="method" aria-label="Method" defaultValue="MPESA">
                    <option value="MPESA">M-Pesa (code from statement)</option>
                    <option value="CASH">Cash</option>
                    <option value="BANK_TRANSFER">Bank transfer</option>
                    <option value="CARD">Card</option>
                    <option value="OTHER">Other</option>
                  </select>
                  <input className="input input-sm" name="amount" inputMode="decimal" defaultValue={String(due / 100)} aria-label="Amount (KES)" />
                  <input className="input input-sm uppercase" name="reference" placeholder="Reference / M-Pesa code" aria-label="Reference" />
                  <input className="input input-sm" name="note" placeholder="Note (optional)" aria-label="Note" />
                  <div className="sm:col-span-2"><SubmitButton className="btn-primary btn-sm">Record payment</SubmitButton></div>
                </ActionForm>
              </details>
            ) : null}
          </section>

          {o.refunds.length || (can("refunds.issue") && refundable > 0) ? (
            <section className="card p-5">
              <h2 className="mb-3 text-lg">Refunds</h2>
              <ul className="space-y-2 text-sm">
                {o.refunds.map((r) => (
                  <li key={r.id} className="rounded border border-line bg-white p-3">
                    <div className="flex flex-wrap justify-between gap-2">
                      <span><strong>{r.number}</strong> · {methodLabel(r.method)}{r.reference ? ` · ${r.reference}` : ""} · {fmtDate(r.createdAt, true)} · by {userName(r.createdById)}</span>
                      <Money cents={r.amountCents} />
                    </div>
                    <p className="text-ink-soft">{r.reason}</p>
                    {r.status === "PENDING_PAYOUT" ? (
                      <ActionForm action={refundPaidOutAction} className="mt-2 flex flex-wrap gap-2">
                        <input type="hidden" name="refundId" value={r.id} />
                        <input type="hidden" name="orderId" value={o.id} />
                        <Badge tone="warn">Money not yet sent</Badge>
                        <input className="input input-sm w-48 uppercase" name="reference" placeholder="M-Pesa reversal / payout ref" aria-label="Payout reference" />
                        <SubmitButton className="btn-secondary btn-sm">Mark as paid out</SubmitButton>
                      </ActionForm>
                    ) : null}
                  </li>
                ))}
              </ul>
              {can("refunds.issue") && refundable > 0 ? (
                <details className="mt-4 rounded border border-line bg-white p-4">
                  <summary className="cursor-pointer font-semibold">Issue a refund (up to <Money cents={refundable} />)</summary>
                  <ActionForm action={refundAction} className="mt-3 space-y-3" confirm="Record this refund? This can't be undone.">
                    <IdempotencyKey />
                    <input type="hidden" name="orderId" value={o.id} />
                    <table className="table">
                      <thead><tr><th>Item</th><th>Refund qty</th><th>Condition of returned goods</th></tr></thead>
                      <tbody>
                        {o.items.filter((i) => i.qty > i.qtyRefunded).map((i) => (
                          <tr key={i.id}>
                            <td>{i.productName} · {i.variantName}<span className="block text-[12px] text-ink-soft">{i.qty - i.qtyRefunded} refundable</span></td>
                            <td><input className="input input-sm w-20" type="number" min={0} max={i.qty - i.qtyRefunded} name={`qty_${i.id}`} defaultValue={0} aria-label={`Refund quantity for ${i.productName}`} /></td>
                            <td>
                              <select className="input input-sm" name={`cond_${i.id}`} defaultValue="RESELLABLE" aria-label="Condition">
                                <option value="RESELLABLE">Returned, can be resold — back to stock</option>
                                <option value="DAMAGED">Returned damaged — to quarantine, not sellable</option>
                                <option value="NOT_RETURNED">Not returned — no stock change</option>
                              </select>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <input className="input input-sm" name="extra" inputMode="decimal" placeholder="Extra amount, e.g. delivery fee (KES)" aria-label="Extra amount" />
                      <select className="input input-sm" name="method" defaultValue={o.payments[0]?.method ?? "MPESA"} aria-label="Refund method">
                        <option value="MPESA">M-Pesa</option>
                        <option value="CASH">Cash{myShift ? " (from my till)" : ""}</option>
                        <option value="BANK_TRANSFER">Bank transfer</option>
                        <option value="CARD">Card</option>
                        <option value="OTHER">Other</option>
                      </select>
                      <input className="input input-sm uppercase" name="reference" placeholder="Transaction ref (leave empty if not sent yet)" aria-label="Reference" />
                      <input className="input input-sm" name="reason" placeholder="Reason (required)" required aria-label="Reason" />
                      {myShift ? <input type="hidden" name="posSessionId" value={myShift.id} /> : null}
                    </div>
                    <p className="text-[13px] text-ink-soft">M-Pesa refunds without a reference are recorded as &quot;payout pending&quot; until you send the money and add the reference. Cash refunds come out of your open till shift.</p>
                    <SubmitButton className="btn-danger btn-sm">Record refund</SubmitButton>
                  </ActionForm>
                </details>
              ) : null}
            </section>
          ) : null}

          <section className="card p-5">
            <h2 className="mb-3 text-lg">Activity</h2>
            {can("orders.manage") ? (
              <ActionForm action={addNoteAction} className="mb-4 flex gap-2" resetOnSuccess>
                <input type="hidden" name="orderId" value={o.id} />
                <input className="input input-sm" name="note" placeholder="Add a staff note" aria-label="Staff note" />
                <SubmitButton className="btn-secondary btn-sm">Add</SubmitButton>
              </ActionForm>
            ) : null}
            <ol className="space-y-2 text-sm">
              {o.events.map((e) => (
                <li key={e.id} className="border-l-2 border-line pl-3">
                  <p>{e.message}</p>
                  <p className="text-[12px] text-ink-soft">{fmtDate(e.createdAt, true)} · {userName(e.userId)}</p>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <aside className="space-y-6">
          {allowed.length ? (
            <section className="card p-5">
              <h2 className="mb-3 text-lg">Next step</h2>
              <div className="space-y-2">
                {allowed.filter((s) => s !== "CANCELLED").map((s) => (
                  <ActionForm key={s} action={changeStatusAction}>
                    <input type="hidden" name="orderId" value={o.id} />
                    <input type="hidden" name="to" value={s} />
                    <SubmitButton className="btn-primary w-full">Mark as {STATUS_LABEL[s].toLowerCase()}</SubmitButton>
                  </ActionForm>
                ))}
                {allowed.includes("CANCELLED") ? (
                  <details className="pt-2">
                    <summary className="cursor-pointer text-sm text-bad">Cancel order</summary>
                    <ActionForm action={changeStatusAction} className="mt-2 space-y-2" confirm="Cancel this order?">
                      <input type="hidden" name="orderId" value={o.id} />
                      <input type="hidden" name="to" value="CANCELLED" />
                      {o.stockState === "COMMITTED" ? (
                        <select className="input input-sm" name="returnCondition" defaultValue="RESELLABLE" aria-label="Goods returned">
                          <option value="RESELLABLE">Goods came back, can be resold</option>
                          <option value="DAMAGED">Goods came back damaged</option>
                          <option value="NOT_RETURNED">Goods not returned</option>
                        </select>
                      ) : null}
                      <input className="input input-sm" name="note" placeholder="Reason (shown to customer)" aria-label="Reason" />
                      <SubmitButton className="btn-danger btn-sm">Cancel order</SubmitButton>
                    </ActionForm>
                  </details>
                ) : null}
              </div>
              {o.amountPaidCents - o.refundedCents > 0 && o.status !== "REFUNDED" ? <p className="mt-3 text-[13px] text-ink-soft">To cancel a paid order, issue a full refund — that closes it.</p> : null}
            </section>
          ) : null}

          <section className="card p-5 text-sm">
            <h2 className="mb-3 text-lg">Customer</h2>
            <p className="font-semibold">{o.contactName}</p>
            <p>{seeContact ? o.contactPhone : maskPhone(o.contactPhone)}</p>
            <p>{seeContact ? o.contactEmail : maskEmail(o.contactEmail)}</p>
            {o.customerId && can("customers.view") ? <p className="mt-2"><Link className="link" href={`/admin/customers/${o.customerId}`}>Customer profile</Link></p> : null}
            {o.notes ? <p className="mt-3 rounded bg-ivory-200/60 p-2">Customer note: {o.notes}</p> : null}
          </section>

          {o.delivery || o.fulfilmentMethod === "COLLECTION" ? (
            <section className="card p-5 text-sm">
              <h2 className="mb-3 text-lg">{o.delivery ? "Delivery" : "Collection"}</h2>
              {addr ? <p>{[addr.street, addr.area, addr.town, addr.county].filter(Boolean).join(", ")}{addr.landmark ? ` — ${addr.landmark}` : ""}</p> : <p>Customer collects from the shop.</p>}
              {o.zone ? <p className="text-ink-soft">Area: {o.zone.name}</p> : null}
              {o.delivery ? (
                <>
                  <p className="mt-2">Status: <strong>{o.delivery.status.toLowerCase()}</strong>{o.delivery.failedReason ? ` — ${o.delivery.failedReason}` : ""}</p>
                  {o.delivery.dispatchedAt ? <p className="text-ink-soft">Dispatched {fmtDate(o.delivery.dispatchedAt, true)}</p> : null}
                  {o.delivery.deliveredAt ? <p className="text-ink-soft">Delivered {fmtDate(o.delivery.deliveredAt, true)}{o.delivery.receivedBy ? ` to ${o.delivery.receivedBy}` : ""}</p> : null}
                  {can("delivery.manage") ? (
                    <>
                      <ActionForm action={deliveryAction} className="mt-3 grid gap-2">
                        <input type="hidden" name="orderId" value={o.id} />
                        <input type="hidden" name="op" value="assign" />
                        <input className="input input-sm" name="riderName" defaultValue={o.delivery.riderName ?? ""} placeholder="Rider name" aria-label="Rider name" />
                        <input className="input input-sm" name="riderPhone" defaultValue={o.delivery.riderPhone ?? ""} placeholder="Rider phone" aria-label="Rider phone" />
                        <input className="input input-sm" name="courierName" defaultValue={o.delivery.courierName ?? ""} placeholder="Courier company" aria-label="Courier" />
                        <input className="input input-sm" name="trackingRef" defaultValue={o.delivery.trackingRef ?? ""} placeholder="Tracking / waybill number" aria-label="Tracking reference" />
                        <SubmitButton className="btn-secondary btn-sm">Save delivery details</SubmitButton>
                      </ActionForm>
                      {o.status === "DISPATCHED" ? (
                        <div className="mt-3 space-y-2">
                          <ActionForm action={deliveryAction} className="flex gap-2">
                            <input type="hidden" name="orderId" value={o.id} />
                            <input type="hidden" name="op" value="delivered" />
                            <input className="input input-sm" name="receivedBy" placeholder="Received by" aria-label="Received by" />
                            <SubmitButton className="btn-primary btn-sm">Delivered</SubmitButton>
                          </ActionForm>
                          <ActionForm action={deliveryAction} className="flex gap-2">
                            <input type="hidden" name="orderId" value={o.id} />
                            <input type="hidden" name="op" value="failed" />
                            <input className="input input-sm" name="failedReason" placeholder="Why it failed" aria-label="Failure reason" />
                            <SubmitButton className="btn-secondary btn-sm">Failed</SubmitButton>
                          </ActionForm>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </>
              ) : null}
            </section>
          ) : null}

          {can("orders.manage") ? (
            <section className="card p-5">
              <h2 className="mb-3 text-lg">Assigned to</h2>
              <ActionForm action={assignOrderAction} className="flex gap-2">
                <input type="hidden" name="orderId" value={o.id} />
                <select className="input input-sm" name="assignedToId" defaultValue={o.assignedToId ?? ""} aria-label="Staff member">
                  <option value="">Nobody</option>
                  {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <SubmitButton className="btn-secondary btn-sm">Save</SubmitButton>
              </ActionForm>
            </section>
          ) : null}

          <section className="card p-5 text-sm">
            <h2 className="mb-3 text-lg">Documents</h2>
            <ul className="space-y-1">
              {o.documents.map((d) => (
                <li key={d.id}>
                  <Link className="link" href={`/documents/${d.id}`} target="_blank">{d.type === "CREDIT_NOTE" ? "Credit note" : d.type === "INVOICE" ? "Invoice" : "Receipt"} {d.number}</Link>
                  {" · "}<a className="link" href={`/documents/${d.id}/pdf`}>PDF</a>
                  {d.printCount ? <span className="text-ink-soft"> · viewed {d.printCount}×</span> : null}
                </li>
              ))}
              {o.documents.length === 0 ? <li className="text-ink-soft">A receipt is issued automatically once the order is fully paid.</li> : null}
            </ul>
            {can("orders.manage") && !o.documents.some((d) => d.type === "INVOICE") && o.status !== "CANCELLED" ? (
              <ActionForm action={issueInvoiceAction} className="mt-3">
                <input type="hidden" name="orderId" value={o.id} />
                <SubmitButton className="btn-secondary btn-sm">Issue A4 invoice</SubmitButton>
              </ActionForm>
            ) : null}
          </section>
        </aside>
      </div>
    </>
  );
}
