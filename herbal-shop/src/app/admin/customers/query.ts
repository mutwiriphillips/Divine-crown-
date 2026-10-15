import { sql } from "drizzle-orm";
import { COUNTED } from "@/lib/reports";

/** Customer list with lifetime figures computed from recorded transactions. Spend = paid order totals − refunds. */
export function customerStatsSql(opts: { q?: string; segment?: string; limit: number; offset: number }) {
  const q = opts.q?.trim();
  const digits = q?.replace(/\D/g, "") ?? "";
  const seg = {
    repeat: sql`and s.orders >= 2`,
    one: sql`and s.orders = 1`,
    none: sql`and coalesce(s.orders,0) = 0`,
    lapsed: sql`and s.last_order < now() - interval '90 days'`,
    wholesale: sql`and c.is_wholesale`,
    marketing: sql`and (c.marketing_email or c.marketing_sms or c.marketing_whatsapp)`,
    new: sql`and c.created_at > now() - interval '30 days'`,
  }[opts.segment ?? ""] ?? sql``;
  return sql`
    with s as (
      select o.customer_id, count(*)::int as orders, sum(o.total_cents - o.refunded_cents)::bigint as spend, max(o.placed_at) as last_order,
        sum(o.refunded_cents)::bigint as refunded
      from orders o where o.status in ${COUNTED} group by o.customer_id)
    select c.id, c.name, c.phone, c.email, c.is_wholesale, c.created_at, c.marketing_email, c.marketing_sms, c.marketing_whatsapp, c.is_demo,
      coalesce(s.orders,0) as orders, coalesce(s.spend,0) as spend, s.last_order, coalesce(s.refunded,0) as refunded, count(*) over() as total
    from customers c left join s on s.customer_id = c.id
    where c.anonymized_at is null
      ${q ? sql`and (c.name ilike ${`%${q}%`} or c.email ilike ${`%${q}%`} ${digits.length >= 4 ? sql`or c.phone like ${`%${digits.slice(-9)}%`}` : sql``})` : sql``}
      ${seg}
    order by coalesce(s.spend,0) desc, c.created_at desc
    limit ${opts.limit} offset ${opts.offset}`;
}
