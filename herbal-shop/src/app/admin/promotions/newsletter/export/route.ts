import { isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth/server";
import { csvResponse, toCsv } from "@/lib/csv";

export async function GET() {
  const u = await getCurrentUser();
  if (!u?.isStaff || !u.permissions.includes("customers.export")) return new Response("Forbidden", { status: 403 });
  const subs = await db.select().from(schema.newsletterSubscribers).where(isNull(schema.newsletterSubscribers.unsubscribedAt));
  const base = process.env.APP_URL ?? "";
  await audit({ userId: u.id, action: "newsletter.export", details: { rows: subs.length } });
  return csvResponse("newsletter-subscribers.csv", toCsv(subs.map((s) => ({ email: s.email, consent_at: s.consentAt.toISOString(), consent_text: s.consentText, unsubscribe_url: `${base}/unsubscribe?token=${s.unsubscribeToken}` }))));
}
