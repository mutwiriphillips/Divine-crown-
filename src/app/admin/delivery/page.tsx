import Link from "next/link";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireStaffPage } from "@/lib/auth/server";
import { STATUS_LABEL } from "@/lib/orders";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, fmtDate, Money, PageHeader } from "@/components/ui";
import { zoneAction } from "./actions";

export const metadata = { title: "Delivery" };

export default async function DeliveryPage() {
  await requireStaffPage("delivery.manage", "/admin/delivery");
  const [zones, queue, perf] = await Promise.all([
    db.select().from(schema.deliveryZones).orderBy(asc(schema.deliveryZones.sortOrder)),
    db
      .select({ o: schema.orders, d: schema.deliveries, zone: schema.deliveryZones.name })
      .from(schema.orders)
      .innerJoin(schema.deliveries, eq(schema.deliveries.orderId, schema.orders.id))
      .leftJoin(schema.deliveryZones, eq(schema.deliveryZones.id, schema.orders.deliveryZoneId))
      .where(inArray(schema.orders.status, ["PAID", "PROCESSING", "DISPATCHED"]))
      .orderBy(asc(schema.orders.placedAt)),
    db.execute<{ delivered: number; failed: number; avg_hours: number | null }>(sql`
      select count(*) filter (where status = 'DELIVERED')::int as delivered, count(*) filter (where status = 'FAILED')::int as failed,
        avg(extract(epoch from delivered_at - dispatched_at) / 3600) filter (where delivered_at is not null and dispatched_at is not null)::numeric(6,1) as avg_hours
      from deliveries where updated_at > now() - interval '30 days'`),
  ]);
  const p = perf.rows[0];
  return (
    <>
      <PageHeader title="Delivery" description={`Last 30 days: ${p.delivered} delivered, ${p.failed} failed${p.avg_hours ? `, average ${p.avg_hours} hours from dispatch to delivery` : ""}.`} />
      <section className="mb-8">
        <h2 className="mb-3 text-xl">To dispatch and on the way</h2>
        {queue.length === 0 ? <p className="text-ink-soft">No deliveries waiting.</p> : (
          <div className="card overflow-x-auto">
            <table className="table">
              <thead><tr><th>Order</th><th>Placed</th><th>Area</th><th>Address</th><th>Status</th><th>Rider / courier</th><th className="text-right">To collect</th></tr></thead>
              <tbody>
                {queue.map(({ o, d, zone }) => {
                  const a = o.deliveryAddress as Record<string, string> | null;
                  return (
                    <tr key={o.id}>
                      <td><Link className="font-semibold text-plum hover:underline" href={`/admin/orders/${o.id}`}>{o.number}</Link></td>
                      <td className="whitespace-nowrap">{fmtDate(o.placedAt, true)}</td>
                      <td>{zone ?? "—"}</td>
                      <td className="text-[13px]">{a ? [a.area, a.town, a.county].filter(Boolean).join(", ") : "—"}</td>
                      <td><Badge tone={o.status === "DISPATCHED" ? "plum" : "warn"}>{STATUS_LABEL[o.status]}</Badge></td>
                      <td className="text-[13px]">{d.riderName ?? d.courierName ?? <span className="text-warn">Not assigned</span>}{d.trackingRef ? ` · ${d.trackingRef}` : ""}</td>
                      <td className="text-right">{o.totalCents > o.amountPaidCents ? <Money cents={o.totalCents - o.amountPaidCents} /> : "Paid"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <h2 className="mb-3 text-xl">Delivery areas and fees</h2>
      <p className="mb-4 text-sm text-ink-soft">Customers choose an area at checkout. Delivery times are shown only if you fill them in. Fees are whole shillings.</p>
      <div className="grid gap-4 lg:grid-cols-2">
        {[...zones, null].map((z, i) => (
          <ActionForm key={z?.id ?? `new${i}`} action={zoneAction} className="card grid gap-2 p-4 sm:grid-cols-2" resetOnSuccess={!z}>
            <p className="font-semibold sm:col-span-2">{z ? z.name : "Add a delivery area"}{z?.isDemo ? " (sample)" : ""}</p>
            {z ? <input type="hidden" name="id" value={z.id} /> : null}
            <input className="input input-sm" name="name" defaultValue={z?.name ?? ""} placeholder="Area name, e.g. Embu town" required aria-label="Area name" />
            <select className="input input-sm" name="method" defaultValue={z?.method ?? "LOCAL_DELIVERY"} aria-label="Type"><option value="LOCAL_DELIVERY">Our rider</option><option value="COURIER">Courier</option></select>
            <input className="input input-sm" name="fee" defaultValue={z ? String(z.feeCents / 100) : ""} placeholder="Fee (KES)" required aria-label="Fee" />
            <input className="input input-sm" name="freeOver" defaultValue={z?.freeOverCents != null ? String(z.freeOverCents / 100) : ""} placeholder="Free over (KES, optional)" aria-label="Free over" />
            <input className="input input-sm" name="etaText" defaultValue={z?.etaText ?? ""} placeholder="Delivery time, e.g. same day (optional)" aria-label="Delivery time" />
            <input className="input input-sm" name="sortOrder" type="number" defaultValue={z?.sortOrder ?? zones.length + 1} aria-label="Order" />
            <select className="input input-sm" name="isActive" defaultValue={z?.isActive === false ? "off" : "on"} aria-label="Status"><option value="on">Shown at checkout</option><option value="off">Hidden</option></select>
            <div><SubmitButton className="btn-secondary btn-sm">{z ? "Save" : "Add area"}</SubmitButton></div>
          </ActionForm>
        ))}
      </div>
    </>
  );
}
