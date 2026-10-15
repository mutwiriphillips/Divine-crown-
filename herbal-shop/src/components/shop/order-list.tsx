import Link from "next/link";
import type { schema } from "@/db";
import { formatKES } from "@/lib/money";
import { STATUS_LABEL } from "@/lib/orders";
import { Badge, fmtDate, ORDER_STATUS_TONE } from "@/components/ui";

export function OrderList({ orders }: { orders: (typeof schema.orders.$inferSelect)[] }) {
  return (
    <ul className="divide-y divide-line border-y border-line">
      {orders.map((o) => (
        <li key={o.id}>
          <Link href={`/account/orders/${o.number}`} className="flex flex-wrap items-center justify-between gap-3 py-4 hover:bg-ivory-200/40">
            <span>
              <span className="font-semibold text-plum">{o.number}</span>
              <span className="ml-3 text-sm text-ink-soft">{fmtDate(o.placedAt)}</span>
            </span>
            <span className="flex items-center gap-3">
              <Badge tone={ORDER_STATUS_TONE[o.status]}>{STATUS_LABEL[o.status]}</Badge>
              <span className="tabular-nums">{formatKES(o.totalCents)}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
