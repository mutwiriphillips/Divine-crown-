import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { currentCustomerId } from "@/lib/cart";
import { OrderList } from "@/components/shop/order-list";

export const metadata = { title: "Your account" };

export default async function AccountHome() {
  const cid = await currentCustomerId();
  const orders = cid ? await db.query.orders.findMany({ where: eq(schema.orders.customerId, cid), orderBy: desc(schema.orders.placedAt), limit: 5 }) : [];
  const open = orders.filter((o) => o.status === "AWAITING_PAYMENT");
  return (
    <div className="space-y-8">
      {open.length ? (
        <div className="rounded bg-warn-100 px-4 py-3 text-warn">
          {open.length === 1 ? "An order is" : `${open.length} orders are`} waiting for payment.{" "}
          <Link className="link font-semibold" href={`/account/orders/${open[0].number}`}>Pay now</Link>
        </div>
      ) : null}
      <section>
        <div className="mb-3 flex items-end justify-between">
          <h2 className="text-2xl">Recent orders</h2>
          <Link className="link text-sm" href="/account/orders">All orders</Link>
        </div>
        {orders.length ? <OrderList orders={orders} /> : <p className="text-ink-soft">No orders yet. <Link className="link" href="/shop">Start shopping</Link>.</p>}
      </section>
    </div>
  );
}

