import { and, eq, gte, ilike, lt, or, sql, type SQL } from "drizzle-orm";
import { schema } from "@/db";

export type OrderFilters = { q?: string; status?: string; pay?: string; source?: string; from?: string; to?: string; assigned?: string; demo?: string };

/** Date range in Nairobi time: from is inclusive, to is inclusive of the whole day. */
export function dateRange(from?: string, to?: string) {
  const f = from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? new Date(`${from}T00:00:00+03:00`) : null;
  const t = to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? new Date(new Date(`${to}T00:00:00+03:00`).getTime() + 86400_000) : null;
  return { from: f, to: t };
}

export function orderWhere(f: OrderFilters): SQL | undefined {
  const o = schema.orders;
  const conds: SQL[] = [];
  const q = f.q?.trim();
  if (q) {
    const digits = q.replace(/\D/g, "");
    conds.push(
      or(
        ilike(o.number, `%${q}%`),
        ilike(o.contactName, `%${q}%`),
        ilike(o.contactEmail, `%${q}%`),
        digits.length >= 6 ? sql`${o.contactPhone} like ${`%${digits.slice(-9)}`}` : sql`false`,
        sql`exists (select 1 from payments p where p.order_id = ${o.id} and p.reference ilike ${q})`,
      )!,
    );
  }
  if (f.status) conds.push(eq(o.status, f.status as "PAID"));
  if (f.pay) conds.push(eq(o.paymentStatus, f.pay as "PAID"));
  if (f.source) conds.push(eq(o.source, f.source as "ONLINE"));
  const r = dateRange(f.from, f.to);
  if (r.from) conds.push(gte(o.placedAt, r.from));
  if (r.to) conds.push(lt(o.placedAt, r.to));
  return conds.length ? and(...conds) : undefined;
}
