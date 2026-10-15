import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth/server";

/** The signed-in customer's own personal data, as JSON. */
export async function GET() {
  const u = await getCurrentUser();
  if (!u) return new Response("Sign in first", { status: 401 });
  const c = await db.query.customers.findFirst({ where: eq(schema.customers.userId, u.id), with: { addresses: true, orders: { with: { items: true, payments: true } }, reviews: true } });
  const tickets = c ? await db.query.supportTickets.findMany({ where: eq(schema.supportTickets.customerId, c.id), with: { messages: { where: (m, { eq }) => eq(m.internal, false) } } }) : [];
  const data = {
    exportedAt: new Date().toISOString(),
    account: { name: u.name, email: u.email, phone: u.phone },
    preferences: c ? { marketingEmail: c.marketingEmail, marketingSms: c.marketingSms, marketingWhatsapp: c.marketingWhatsapp, consentUpdatedAt: c.consentUpdatedAt } : null,
    addresses: c?.addresses ?? [],
    orders: (c?.orders ?? []).map((o) => ({
      number: o.number, placedAt: o.placedAt, status: o.status, totalKES: o.totalCents / 100, deliveryAddress: o.deliveryAddress,
      items: o.items.map((i) => ({ product: i.productName, variant: i.variantName, qty: i.qty, amountKES: i.lineTotalCents / 100 })),
      payments: o.payments.map((p) => ({ method: p.method, amountKES: p.amountCents / 100, reference: p.reference, receivedAt: p.receivedAt })),
    })),
    reviews: (c?.reviews ?? []).map((r) => ({ type: r.type, rating: r.rating, title: r.title, body: r.body, status: r.status, createdAt: r.createdAt })),
    supportRequests: tickets.map((t) => ({ number: t.number, subject: t.subject, status: t.status, messages: t.messages.map((m) => ({ fromYou: m.fromCustomer, body: m.body, at: m.createdAt })) })),
  };
  await audit({ userId: u.id, action: "privacy.export", entityType: "user", entityId: u.id });
  return new Response(JSON.stringify(data, null, 2), {
    headers: { "Content-Type": "application/json", "Content-Disposition": 'attachment; filename="my-data.json"', "Cache-Control": "no-store" },
  });
}
