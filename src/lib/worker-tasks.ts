import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { claimJobs, completeJob, enqueueJob, failJob, type JobRow } from "@/lib/jobs";
import { formatKES } from "@/lib/money";
import { notify, notifyStaff } from "@/lib/notifications";
import { deliver } from "@/lib/notifications/providers";
import { expireUnpaidOrders } from "@/lib/orders";
import { reconcilePendingAttempts } from "@/lib/payments/mpesa";
import { getSetting } from "@/lib/settings";

/** Nairobi calendar date (YYYY-MM-DD) and hour. */
export function nairobiNow(d = new Date()) {
  const eat = new Date(d.getTime() + 3 * 3600_000);
  return { date: eat.toISOString().slice(0, 10), hour: eat.getUTCHours() };
}

async function runJob(job: JobRow) {
  const payload = (job.payload ?? {}) as Record<string, unknown>;
  switch (job.type) {
    case "send_notification": {
      const id = String(payload.notificationId);
      const n = await db.query.notifications.findFirst({ where: eq(schema.notifications.id, id) });
      if (!n || n.status === "SENT" || n.status === "SKIPPED") return;
      await db.update(schema.notifications).set({ attempts: n.attempts + 1 }).where(eq(schema.notifications.id, id));
      try {
        const r = await deliver(n);
        await db
          .update(schema.notifications)
          .set(r.status === "SENT" ? { status: "SENT", sentAt: new Date(), lastError: null } : { status: "SKIPPED", skipReason: r.reason })
          .where(eq(schema.notifications.id, id));
      } catch (e) {
        const msg = (e as Error).message.slice(0, 500);
        // Mark FAILED only once retries are exhausted; until then the job queue retries with backoff.
        await db.update(schema.notifications).set({ lastError: msg, status: job.attempts >= job.maxAttempts ? "FAILED" : "QUEUED" }).where(eq(schema.notifications.id, id));
        throw e;
      }
      return;
    }
    case "daily_summary":
      return dailySummary(String(payload.date));
    case "low_stock_check":
      return lowStockCheck(String(payload.date));
    case "abandoned_carts":
      return abandonedCarts();
    default:
      throw new Error(`Unknown job type ${job.type}`);
  }
}

export async function processJobs(workerId: string, max = 25) {
  const jobs = await claimJobs(workerId, max);
  for (const job of jobs) {
    try {
      await runJob(job);
      await completeJob(job.id);
    } catch (e) {
      await failJob(job, (e as Error).message ?? String(e));
    }
  }
  return jobs.length;
}

/** Periodic housekeeping. Safe to call often and from several places: every step is idempotent. */
export async function scheduledTick() {
  const out: Record<string, number> = {};
  out.expiredOrders = await expireUnpaidOrders();
  out.reconciledPayments = await reconcilePendingAttempts().catch((e) => {
    console.error("reconcile failed", e);
    return 0;
  });
  const { date, hour } = nairobiNow();
  if (hour >= 21) await enqueueJob(db, "daily_summary", { date }, { dedupeKey: `daily_summary:${date}` });
  if (hour >= 8) await enqueueJob(db, "low_stock_check", { date }, { dedupeKey: `low_stock:${date}` });
  await enqueueJob(db, "abandoned_carts", {}, { dedupeKey: `abandoned:${date}:${hour}` });
  return out;
}

async function dailySummary(date: string) {
  const start = new Date(`${date}T00:00:00+03:00`);
  const end = new Date(start.getTime() + 86400_000);
  const r = await db.execute<{ orders: number; gross: number }>(sql`
    select count(*)::int as orders, coalesce(sum(total_cents),0)::int as gross from orders
     where placed_at >= ${start} and placed_at < ${end} and status not in ('CANCELLED','AWAITING_PAYMENT','PENDING') and is_demo = false`);
  const ref = await db.execute<{ refunds: number }>(sql`select coalesce(sum(amount_cents),0)::int as refunds from refunds where created_at >= ${start} and created_at < ${end}`);
  const commerce = await getSetting("commerce");
  const vars = { date, orders: Number(r.rows[0].orders), gross: formatKES(Number(r.rows[0].gross)), refunds: formatKES(Number(ref.rows[0].refunds)) };
  await notifyStaff(db, {
    event: "staff.daily_summary",
    dedupeKey: `daily_summary:${date}`,
    vars: { ...vars, body: `Orders: ${vars.orders}\nGross sales (paid orders, incl. delivery): ${vars.gross}\nRefunds issued: ${vars.refunds}` },
    emailTo: commerce.dailySummaryEmail || null,
  });
}

async function lowStockCheck(date: string) {
  const r = await db.execute<{ name: string; variant: string; avail: number; level: number }>(sql`
    select p.name, v.name as variant, coalesce(sum(b.on_hand - b.reserved),0)::int as avail, v.reorder_level as level
      from product_variants v join products p on p.id = v.product_id left join inventory_balances b on b.variant_id = v.id
     where v.is_active and not v.is_bundle and v.reorder_level > 0 and p.status <> 'ARCHIVED'
     group by p.name, v.name, v.reorder_level having coalesce(sum(b.on_hand - b.reserved),0) <= v.reorder_level
     order by avail asc limit 50`);
  if (!r.rows.length) return;
  const commerce = await getSetting("commerce");
  await notifyStaff(db, {
    event: "staff.low_stock",
    dedupeKey: `low_stock:${date}`,
    vars: { count: r.rows.length, list: r.rows.map((x) => `${x.name} (${x.variant}): ${x.avail} left`).join("; ") },
    emailTo: commerce.lowStockEmail || null,
  });
}

/** Reminders only for signed-in customers who opted in to marketing email, once per cart, 4–48 hours after the last change. */
async function abandonedCarts() {
  const commerce = await getSetting("commerce");
  if (!commerce.abandonedCartReminders) return;
  const carts = await db
    .select({ cart: schema.carts, customer: schema.customers })
    .from(schema.carts)
    .innerJoin(schema.customers, eq(schema.customers.id, schema.carts.customerId))
    .where(
      and(
        isNull(schema.carts.reminderSentAt),
        eq(schema.customers.marketingEmail, true),
        lt(schema.carts.updatedAt, new Date(Date.now() - 4 * 3600_000)),
        sql`${schema.carts.updatedAt} > now() - interval '48 hours'`,
        sql`exists (select 1 from cart_items ci where ci.cart_id = ${schema.carts.id})`,
      ),
    )
    .limit(100);
  for (const { cart, customer } of carts) {
    await db.transaction(async (tx) => {
      await notify(tx, {
        event: "cart.reminder",
        entityType: "cart",
        entityId: cart.id,
        dedupeSuffix: cart.updatedAt.toISOString().slice(0, 13),
        marketing: true,
        to: { customerId: customer.id, name: customer.name, email: customer.email },
        vars: { cartUrl: `${process.env.APP_URL ?? ""}/cart`, prefsUrl: `${process.env.APP_URL ?? ""}/account/profile` },
      });
      await tx.update(schema.carts).set({ reminderSentAt: new Date() }).where(eq(schema.carts.id, cart.id));
    });
  }
}
