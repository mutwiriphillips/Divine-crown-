import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { canAccessOrder, findOrderByNumber } from "@/lib/order-access";

export async function GET(req: Request, { params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  const order = await findOrderByNumber(number);
  const key = new URL(req.url).searchParams.get("key");
  if (!order || !(await canAccessOrder(order, key))) return Response.json({ error: "not_found" }, { status: 404 });
  const attempt = await db.query.paymentAttempts.findFirst({ where: eq(schema.paymentAttempts.orderId, order.id), orderBy: desc(schema.paymentAttempts.createdAt) });
  return Response.json(
    {
      status: order.status,
      paymentStatus: order.paymentStatus,
      amountPaidCents: order.amountPaidCents,
      totalCents: order.totalCents,
      attempt: attempt ? { id: attempt.id, status: attempt.status, resultDesc: attempt.resultDesc } : null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
