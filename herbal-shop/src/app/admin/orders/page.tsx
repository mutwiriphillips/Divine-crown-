import Link from "next/link";
import { desc, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireStaffPage } from "@/lib/auth/server";
import { PAYMENT_STATUS_LABEL, STATUS_LABEL } from "@/lib/orders";
import { orderWhere } from "@/lib/order-query";
import { maskPhone } from "@/lib/text";
import { Badge, EmptyState, fmtDate, Money, ORDER_STATUS_TONE, PageHeader, Pagination } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { bulkStatusAction } from "./actions";

export const metadata = { title: "Orders" };
const PAGE = 40;

export default async function OrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireStaffPage("orders.view", "/admin/orders");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const where = orderWhere(sp);
  const [rows, count, needs] = await Promise.all([
    db.select().from(schema.orders).where(where).orderBy(desc(schema.orders.placedAt)).limit(PAGE).offset((page - 1) * PAGE),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.orders).where(where),
    db.execute<{ awaiting: number; to_dispatch: number; ready: number }>(sql`select
      count(*) filter (where status = 'AWAITING_PAYMENT')::int as awaiting,
      count(*) filter (where status in ('PAID','PROCESSING') and fulfilment_method in ('LOCAL_DELIVERY','COURIER'))::int as to_dispatch,
      count(*) filter (where status in ('PAID','PROCESSING') and fulfilment_method = 'COLLECTION')::int as ready
      from orders`),
  ]);
  const itemCounts = rows.length
    ? await db.select({ orderId: schema.orderItems.orderId, n: sql<number>`sum(qty)::int` }).from(schema.orderItems).where(inArray(schema.orderItems.orderId, rows.map((r) => r.id))).groupBy(schema.orderItems.orderId)
    : [];
  const itemMap = new Map(itemCounts.map((x) => [x.orderId, x.n]));
  const seeContact = user.permissions.includes("customers.view_contact");
  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `?${p.toString()}`;
  };
  const n = needs.rows[0];
  const canManage = user.permissions.includes("orders.manage");

  return (
    <>
      <PageHeader
        title="Orders"
        description="Online, point-of-sale and manual orders. Totals include delivery and are after discounts."
        actions={<a className="btn-secondary" href={`/admin/orders/export${qs({})}`}>Export CSV</a>}
      />
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        <Link className="btn-secondary btn-sm" href="?status=AWAITING_PAYMENT">Awaiting payment ({n.awaiting})</Link>
        <Link className="btn-secondary btn-sm" href="?status=PAID">Paid, not started</Link>
        <Link className="btn-secondary btn-sm" href="/admin/delivery">To dispatch ({n.to_dispatch})</Link>
        <Link className="btn-secondary btn-sm" href="?status=PROCESSING">Processing</Link>
        <span className="self-center text-ink-soft">For collection: {n.ready}</span>
      </div>
      <form className="mb-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-7" role="search">
        <input className="input input-sm lg:col-span-2" name="q" defaultValue={sp.q} placeholder="Order no., name, phone, M-Pesa code" aria-label="Search" />
        <select className="input input-sm" name="status" defaultValue={sp.status ?? ""} aria-label="Status">
          <option value="">Any status</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="input input-sm" name="pay" defaultValue={sp.pay ?? ""} aria-label="Payment">
          <option value="">Any payment</option>
          {Object.entries(PAYMENT_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="input input-sm" name="source" defaultValue={sp.source ?? ""} aria-label="Source">
          <option value="">All sources</option>
          <option value="ONLINE">Online</option>
          <option value="POS">Point of sale</option>
          <option value="MANUAL">Manual</option>
        </select>
        <input className="input input-sm" type="date" name="from" defaultValue={sp.from} aria-label="From date" />
        <div className="flex gap-2">
          <input className="input input-sm" type="date" name="to" defaultValue={sp.to} aria-label="To date" />
          <button className="btn-secondary btn-sm">Filter</button>
        </div>
      </form>
      {rows.length === 0 ? (
        <EmptyState title="No orders found">{Object.keys(sp).length ? "Try clearing the filters." : "Orders from the shop and the till will appear here."}</EmptyState>
      ) : (
        <ActionForm action={bulkStatusAction}>
          {canManage ? (
            <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-ink-soft">Selected orders:</span>
              <SubmitButton className="btn-secondary btn-sm" name="to" value="PROCESSING">Mark processing</SubmitButton>
              <SubmitButton className="btn-secondary btn-sm" name="to" value="READY_FOR_COLLECTION">Ready for collection</SubmitButton>
              <SubmitButton className="btn-secondary btn-sm" name="to" value="DISPATCHED">Dispatched</SubmitButton>
            </div>
          ) : null}
          <div className="card overflow-x-auto">
            <table className="table [&_td]:align-middle">
              <thead>
                <tr>
                  {canManage ? <th className="w-8"><span className="sr-only">Select</span></th> : null}
                  <th>Order</th><th>Date</th><th>Customer</th><th>Items</th><th>Fulfilment</th><th>Status</th><th>Payment</th><th className="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.id}>
                    {canManage ? <td><input type="checkbox" className="checkbox" name="ids" value={o.id} aria-label={`Select ${o.number}`} /></td> : null}
                    <td>
                      <Link className="font-semibold text-plum hover:underline" href={`/admin/orders/${o.id}`}>{o.number}</Link>
                      <span className="block text-[12px] text-ink-soft">{o.source === "POS" ? "Till" : o.source === "ONLINE" ? "Online" : "Manual"}{o.isDemo ? " · sample" : ""}</span>
                    </td>
                    <td className="whitespace-nowrap">{fmtDate(o.placedAt, true)}</td>
                    <td>{o.contactName}<span className="block text-[12px] text-ink-soft">{seeContact ? o.contactPhone : maskPhone(o.contactPhone)}</span></td>
                    <td className="tabular-nums">{itemMap.get(o.id) ?? 0}</td>
                    <td>{{ COLLECTION: "Collection", LOCAL_DELIVERY: "Local delivery", COURIER: "Courier", WALK_IN: "Walk-in" }[o.fulfilmentMethod]}</td>
                    <td><Badge tone={ORDER_STATUS_TONE[o.status]}>{STATUS_LABEL[o.status]}</Badge></td>
                    <td><Badge tone={ORDER_STATUS_TONE[o.paymentStatus] ?? "neutral"}>{PAYMENT_STATUS_LABEL[o.paymentStatus]}</Badge></td>
                    <td className="text-right"><Money cents={o.totalCents} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ActionForm>
      )}
      <Pagination page={page} pageSize={PAGE} total={count[0].n} hrefFor={(p) => qs({ page: String(p) })} />
    </>
  );
}
