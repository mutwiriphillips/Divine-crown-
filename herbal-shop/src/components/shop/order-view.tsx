import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { mpesaMode } from "@/lib/payments/mpesa";
import { formatKES } from "@/lib/money";
import { PAYMENT_STATUS_LABEL, STATUS_LABEL } from "@/lib/orders";
import { methodLabel } from "@/lib/documents";
import { Badge, fmtDate, ORDER_STATUS_TONE } from "@/components/ui";
import { PaymentPanel } from "./payment-panel";
import { payWithMpesaAction } from "@/app/(shop)/payment-actions";

const STEPS: { key: string; label: string; match: string[] }[] = [
  { key: "placed", label: "Order placed", match: [] },
  { key: "paid", label: "Paid", match: ["PAID"] },
  { key: "ready", label: "Packed / on the way", match: ["PROCESSING", "READY_FOR_COLLECTION", "DISPATCHED"] },
  { key: "done", label: "Received", match: ["DELIVERED", "COMPLETED"] },
];

export async function OrderView({ orderId, accessKey, isNew }: { orderId: string; accessKey: string | null; isNew?: boolean }) {
  const order = await db.query.orders.findFirst({
    where: eq(schema.orders.id, orderId),
    with: {
      items: true,
      payments: { orderBy: (p) => asc(p.receivedAt) },
      events: { orderBy: (e) => asc(e.createdAt) },
      documents: true,
      delivery: true,
      zone: true,
      refunds: true,
    },
  });
  if (!order) return null;
  const due = Math.max(0, order.totalCents - order.amountPaidCents);
  const showPay = order.paymentMethodChosen === "MPESA" && due > 0 && ["AWAITING_PAYMENT", "PENDING"].includes(order.status) && mpesaMode() !== "disabled";
  const reachedStatuses = new Set(order.events.map((e) => e.toStatus).filter(Boolean) as string[]);
  if (order.paymentStatus === "PAID") reachedStatuses.add("PAID");
  const addr = order.deliveryAddress as { county?: string; town?: string; area?: string; street?: string; landmark?: string } | null;
  const cancelled = order.status === "CANCELLED";
  const linkSuffix = accessKey ? `?key=${encodeURIComponent(accessKey)}` : "";

  return (
    <div className="space-y-8">
      <div>
        {isNew ? <p className="mb-2 text-lg text-ok">Thank you — your order has been placed.</p> : null}
        <h1 className="text-4xl">Order {order.number}</h1>
        <p className="mt-2 flex flex-wrap items-center gap-2 text-ink-soft">
          Placed {fmtDate(order.placedAt, true)}
          <Badge tone={ORDER_STATUS_TONE[order.status]}>{STATUS_LABEL[order.status]}</Badge>
          {PAYMENT_STATUS_LABEL[order.paymentStatus] !== STATUS_LABEL[order.status] ? <Badge tone={ORDER_STATUS_TONE[order.paymentStatus] ?? "neutral"}>{PAYMENT_STATUS_LABEL[order.paymentStatus]}</Badge> : null}
        </p>
      </div>

      {showPay ? (
        <PaymentPanel
          number={order.number}
          accessKey={accessKey}
          amountDue={due}
          defaultPhone={(order.contactPhone ?? "").replace(/^254/, "0")}
          simulator={mpesaMode() === "simulator"}
          action={payWithMpesaAction}
        />
      ) : null}
      {order.status === "AWAITING_PAYMENT" && order.reservationExpiresAt ? (
        <p className="text-sm text-ink-soft">We&apos;re holding your items until {fmtDate(order.reservationExpiresAt, true)}. Unpaid orders are released after that.</p>
      ) : null}
      {order.paymentMethodChosen === "CASH_ON_DELIVERY" && due > 0 && !cancelled ? (
        <p className="rounded bg-plum-50 px-4 py-3 text-plum">Pay {formatKES(due)} when you receive your order, by cash or M-Pesa.</p>
      ) : null}

      {!cancelled ? (
        <ol className="grid grid-cols-4 gap-2 text-center text-[13px]" aria-label="Order progress">
          {STEPS.map((s, i) => {
            const done = i === 0 || s.match.some((m) => reachedStatuses.has(m)) || (s.key === "paid" && order.paymentStatus === "PAID") || (s.key === "ready" && reachedStatuses.has("DELIVERED")) || (s.key === "ready" && reachedStatuses.has("COMPLETED"));
            return (
              <li key={s.key}>
                <span className={`mb-1 block h-1.5 rounded-full ${done ? "bg-plum" : "bg-line"}`} />
                <span className={done ? "font-semibold text-plum" : "text-ink-faint"}>{s.label}</span>
              </li>
            );
          })}
        </ol>
      ) : null}

      <div className="grid gap-8 md:grid-cols-[1.4fr_1fr]">
        <section>
          <h2 className="mb-3 text-2xl">Items</h2>
          <ul className="divide-y divide-line border-y border-line">
            {order.items.map((i) => (
              <li key={i.id} className="flex justify-between gap-4 py-3">
                <span>
                  {i.productName}
                  {i.variantName !== "Standard" ? <span className="text-ink-soft"> · {i.variantName}</span> : null} × {i.qty}
                  {i.qtyRefunded ? <span className="block text-sm text-clay-700">{i.qtyRefunded} refunded</span> : null}
                </span>
                <span className="tabular-nums">{formatKES(i.lineTotalCents)}</span>
              </li>
            ))}
          </ul>
          <dl className="mt-3 space-y-1 text-[15px]">
            <div className="flex justify-between"><dt>Subtotal</dt><dd className="tabular-nums">{formatKES(order.subtotalCents)}</dd></div>
            {order.discountCents ? <div className="flex justify-between text-ok"><dt>Discount{order.couponCode ? ` (${order.couponCode})` : ""}</dt><dd className="tabular-nums">−{formatKES(order.discountCents)}</dd></div> : null}
            {order.fulfilmentMethod !== "COLLECTION" && order.fulfilmentMethod !== "WALK_IN" ? <div className="flex justify-between"><dt>Delivery</dt><dd className="tabular-nums">{order.deliveryFeeCents ? formatKES(order.deliveryFeeCents) : "Free"}</dd></div> : null}
            {!order.taxInclusive && order.taxCents ? <div className="flex justify-between"><dt>VAT</dt><dd className="tabular-nums">{formatKES(order.taxCents)}</dd></div> : null}
            <div className="flex justify-between border-t border-line pt-2 text-lg font-semibold"><dt>Total</dt><dd className="tabular-nums">{formatKES(order.totalCents)}</dd></div>
            {order.amountPaidCents ? <div className="flex justify-between text-ink-soft"><dt>Paid</dt><dd className="tabular-nums">{formatKES(order.amountPaidCents)}</dd></div> : null}
            {order.refundedCents ? <div className="flex justify-between text-clay-700"><dt>Refunded</dt><dd className="tabular-nums">{formatKES(order.refundedCents)}</dd></div> : null}
          </dl>
          {order.payments.length ? (
            <ul className="mt-3 text-sm text-ink-soft">
              {order.payments.filter((p) => p.status === "SUCCEEDED").map((p) => (
                <li key={p.id}>{methodLabel(p.method)} {formatKES(p.amountCents)}{p.reference ? ` · ref ${p.reference}` : ""} · {fmtDate(p.receivedAt, true)}</li>
              ))}
            </ul>
          ) : null}
        </section>
        <section className="space-y-5">
          <div>
            <h2 className="mb-2 text-2xl">{order.fulfilmentMethod === "COLLECTION" ? "Collection" : order.fulfilmentMethod === "WALK_IN" ? "In-store purchase" : "Delivery"}</h2>
            {addr ? (
              <p className="text-ink-soft">{[addr.street, addr.area, addr.town, addr.county].filter(Boolean).join(", ")}{addr.landmark ? <><br />{addr.landmark}</> : null}</p>
            ) : order.fulfilmentMethod === "COLLECTION" ? (
              <p className="text-ink-soft">{order.status === "READY_FOR_COLLECTION" ? "Ready — come and collect it." : "We'll tell you when it's ready to collect."}</p>
            ) : null}
            {order.zone ? <p className="text-sm text-ink-soft">Area: {order.zone.name}</p> : null}
            {order.delivery && (order.delivery.courierName || order.delivery.trackingRef || order.delivery.riderName) ? (
              <p className="mt-2 text-sm">
                {order.delivery.courierName ? <>Courier: {order.delivery.courierName}<br /></> : null}
                {order.delivery.trackingRef ? <>Tracking: {order.delivery.trackingRef}<br /></> : null}
                {order.delivery.riderName ? <>Rider: {order.delivery.riderName}</> : null}
              </p>
            ) : null}
          </div>
          {order.documents.length ? (
            <div>
              <h2 className="mb-2 text-2xl">Documents</h2>
              <ul className="space-y-1">
                {order.documents.map((d) => (
                  <li key={d.id}>
                    <Link className="link" href={`/documents/${d.id}${linkSuffix}`}>{d.type === "CREDIT_NOTE" ? "Credit note" : d.isTaxInvoice ? "Tax invoice" : d.type === "INVOICE" ? "Invoice" : "Receipt"} {d.number}</Link>
                    {" · "}
                    <a className="link" href={`/documents/${d.id}/pdf${linkSuffix}`}>PDF</a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div>
            <h2 className="mb-2 text-2xl">Need help?</h2>
            <ul className="space-y-1 text-sm">
              <li><Link className="link" href={`/support?order=${order.number}`}>Ask about this order</Link></li>
              {!cancelled && order.amountPaidCents === 0 && ["AWAITING_PAYMENT", "PROCESSING", "PENDING"].includes(order.status) ? (
                <li><Link className="link" href={`/support?order=${order.number}&category=CANCELLATION_REQUEST`}>Ask to cancel</Link></li>
              ) : null}
              {["DELIVERED", "COMPLETED"].includes(order.status) ? (
                <li><Link className="link" href={`/support?order=${order.number}&category=RETURN_REQUEST`}>Request a return</Link></li>
              ) : null}
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}
