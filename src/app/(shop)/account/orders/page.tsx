import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { currentCustomerId } from "@/lib/cart";
import { OrderList } from "@/components/shop/order-list";

export const metadata = { title: "Your orders" };

export default async function OrdersPage() {
  const cid = await currentCustomerId();
  const orders = cid ? await db.query.orders.findMany({ where: eq(schema.orders.customerId, cid), orderBy: desc(schema.orders.placedAt), limit: 200 }) : [];
  return (
    <section>
      <h2 className="mb-3 text-2xl">Orders</h2>
      {orders.length ? <OrderList orders={orders} /> : <p className="text-ink-soft">No orders yet. <Link className="link" href="/shop">Start shopping</Link>.</p>}
    </section>
  );
}
