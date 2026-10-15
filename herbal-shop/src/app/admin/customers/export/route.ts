import { db } from "@/db";
import { audit } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth/server";
import { csvResponse, toCsv } from "@/lib/csv";
import { centsToDecimalString } from "@/lib/money";
import { customerStatsSql } from "../query";

/** Contains personal data: restricted to customers.export, and every export is audit-logged. */
export async function GET(req: Request) {
  const u = await getCurrentUser();
  if (!u?.isStaff || !u.permissions.includes("customers.export")) return new Response("Forbidden", { status: 403 });
  const sp = Object.fromEntries(new URL(req.url).searchParams.entries());
  const res = await db.execute(customerStatsSql({ q: sp.q, segment: sp.segment, limit: 50000, offset: 0 }));
  const rows = res.rows as Record<string, unknown>[];
  const csv = toCsv(
    rows.map((c) => ({
      name: c.name,
      phone: c.phone,
      email: c.email,
      wholesale: c.is_wholesale ? "yes" : "no",
      orders: c.orders,
      lifetime_spend_kes: centsToDecimalString(Number(c.spend)),
      last_order: c.last_order ? new Date(c.last_order as string).toISOString().slice(0, 10) : "",
      joined: new Date(c.created_at as string).toISOString().slice(0, 10),
      marketing_email: c.marketing_email ? "yes" : "no",
      marketing_sms: c.marketing_sms ? "yes" : "no",
      marketing_whatsapp: c.marketing_whatsapp ? "yes" : "no",
    })),
  );
  await audit({ userId: u.id, action: "customers.export", details: { rows: rows.length, filters: sp } });
  return csvResponse(`customers-${new Date().toISOString().slice(0, 10)}.csv`, csv);
}
