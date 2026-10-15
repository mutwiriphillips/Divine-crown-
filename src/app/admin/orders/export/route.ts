import { desc } from "drizzle-orm";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth/server";
import { csvResponse, toCsv } from "@/lib/csv";
import { centsToDecimalString } from "@/lib/money";
import { orderWhere } from "@/lib/order-query";
import { maskPhone } from "@/lib/text";

export async function GET(req: Request) {
  const u = await getCurrentUser();
  if (!u?.isStaff || !u.permissions.includes("orders.view")) return new Response("Forbidden", { status: 403 });
  const sp = Object.fromEntries(new URL(req.url).searchParams.entries());
  const rows = await db.select().from(schema.orders).where(orderWhere(sp)).orderBy(desc(schema.orders.placedAt)).limit(20000);
  const contact = u.permissions.includes("customers.view_contact");
  const m = centsToDecimalString;
  const csv = toCsv(
    rows.map((o) => ({
      order_number: o.number,
      placed_at: o.placedAt.toISOString(),
      source: o.source,
      status: o.status,
      payment_status: o.paymentStatus,
      fulfilment: o.fulfilmentMethod,
      customer: o.contactName,
      phone: contact ? o.contactPhone : maskPhone(o.contactPhone),
      subtotal_kes: m(o.subtotalCents),
      discount_kes: m(o.discountCents),
      delivery_kes: m(o.deliveryFeeCents),
      tax_kes: m(o.taxCents),
      total_kes: m(o.totalCents),
      paid_kes: m(o.amountPaidCents),
      refunded_kes: m(o.refundedCents),
      coupon: o.couponCode,
      sample_data: o.isDemo ? "yes" : "no",
    })),
  );
  await audit({ userId: u.id, action: "orders.export", details: { rows: rows.length, filters: sp } });
  return csvResponse(`orders-${new Date().toISOString().slice(0, 10)}.csv`, csv);
}
