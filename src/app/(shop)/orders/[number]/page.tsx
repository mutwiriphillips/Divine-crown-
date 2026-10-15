import { notFound } from "next/navigation";
import { canAccessOrder, findOrderByNumber } from "@/lib/order-access";
import { OrderView } from "@/components/shop/order-view";

export const metadata = { title: "Your order", robots: { index: false } };

export default async function OrderPage({ params, searchParams }: { params: Promise<{ number: string }>; searchParams: Promise<{ key?: string; new?: string }> }) {
  const { number } = await params;
  const sp = await searchParams;
  const order = await findOrderByNumber(number);
  // Same response for "doesn't exist" and "not yours", so order numbers can't be probed.
  if (!order || !(await canAccessOrder(order, sp.key ?? null))) notFound();
  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <OrderView orderId={order.id} accessKey={sp.key ?? null} isNew={sp.new === "1"} />
      {sp.key ? <p className="mt-10 text-sm text-ink-soft">Keep this page&apos;s link private — anyone with it can see this order.</p> : null}
    </div>
  );
}
