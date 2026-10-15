import { and, eq } from "drizzle-orm";
import { db, schema, type Executor } from "@/db";
import { enqueueJob } from "@/lib/jobs";
import { getSetting } from "@/lib/settings";
import { DEFAULT_TEMPLATES, renderTemplate } from "./templates";
import { channelConfigured } from "./providers";

type Channel = "EMAIL" | "WHATSAPP" | "SMS" | "STAFF";

export type Recipient = {
  customerId?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
};

/**
 * Queue notifications for an event. Call inside the business transaction: if the transaction rolls back,
 * nothing is sent. The dedupe key makes repeated calls (e.g. a retried payment callback) harmless.
 *
 * - transactional messages (order/payment/refund) go to every configured channel the customer has an address for
 * - marketing messages (cart reminders) only go to channels the customer has opted in to
 */
export async function notify(
  exec: Executor,
  args: {
    event: string;
    entityType: string;
    entityId: string;
    dedupeSuffix?: string;
    to: Recipient;
    vars: Record<string, string | number | null | undefined>;
    marketing?: boolean;
  },
) {
  const defs = DEFAULT_TEMPLATES[args.event];
  if (!defs) throw new Error(`Unknown notification event ${args.event}`);
  const business = await getSetting("business", exec);
  const vars = { shopName: business.name, ...args.vars, name: args.vars.name ?? args.to.name ?? "there" };

  let consent = { EMAIL: true, SMS: true, WHATSAPP: true };
  if (args.marketing) {
    const c = args.to.customerId ? await exec.query.customers.findFirst({ where: eq(schema.customers.id, args.to.customerId) }) : null;
    consent = { EMAIL: !!c?.marketingEmail, SMS: !!c?.marketingSms, WHATSAPP: !!c?.marketingWhatsapp };
  }

  for (const channel of Object.keys(defs) as Channel[]) {
    if (channel === "STAFF") continue;
    const recipient = channel === "EMAIL" ? args.to.email : args.to.phone;
    if (!recipient) continue;
    if (!consent[channel]) continue;
    // SMS/WhatsApp are only queued when a provider is configured; email is always queued so the
    // owner can see (and later resend) what would have gone out.
    if (channel !== "EMAIL" && !channelConfigured(channel)) continue;
    const tpl = await resolveTemplate(exec, args.event, channel);
    if (!tpl) continue;
    await insertNotification(exec, {
      dedupeKey: `${args.event}:${channel}:${args.entityId}${args.dedupeSuffix ? ":" + args.dedupeSuffix : ""}`,
      channel,
      templateKey: args.event,
      recipient,
      subject: tpl.subject ? renderTemplate(tpl.subject, vars) : null,
      body: renderTemplate(tpl.body, vars),
      entityType: args.entityType,
      entityId: args.entityId,
    });
  }
}

/** In-app alert for staff (shown on the dashboard), optionally also emailed to the owner's address. */
export async function notifyStaff(
  exec: Executor,
  args: { event: string; entityType?: string; entityId?: string; dedupeKey: string; vars: Record<string, string | number | null | undefined>; emailTo?: string | null },
) {
  const business = await getSetting("business", exec);
  const vars = { shopName: business.name, ...args.vars };
  const tpl = await resolveTemplate(exec, args.event, "STAFF");
  if (tpl) {
    await exec
      .insert(schema.notifications)
      .values({
        dedupeKey: `${args.dedupeKey}:STAFF`,
        channel: "STAFF",
        templateKey: args.event,
        recipient: "staff",
        body: renderTemplate(tpl.body, vars),
        status: "SENT",
        sentAt: new Date(),
        entityType: args.entityType,
        entityId: args.entityId,
      })
      .onConflictDoNothing({ target: schema.notifications.dedupeKey });
  }
  if (args.emailTo) {
    const etpl = await resolveTemplate(exec, args.event, "EMAIL");
    if (etpl) {
      await insertNotification(exec, {
        dedupeKey: `${args.dedupeKey}:EMAIL`,
        channel: "EMAIL",
        templateKey: args.event,
        recipient: args.emailTo,
        subject: etpl.subject ? renderTemplate(etpl.subject, vars) : null,
        body: renderTemplate(etpl.body, vars),
        entityType: args.entityType,
        entityId: args.entityId,
      });
    }
  }
}

async function insertNotification(
  exec: Executor,
  n: { dedupeKey: string; channel: Channel; templateKey: string; recipient: string; subject: string | null; body: string; entityType?: string; entityId?: string },
) {
  const inserted = await exec
    .insert(schema.notifications)
    .values({ ...n, status: "QUEUED" })
    .onConflictDoNothing({ target: schema.notifications.dedupeKey })
    .returning({ id: schema.notifications.id });
  if (inserted[0]) {
    await enqueueJob(exec, "send_notification", { notificationId: inserted[0].id }, { dedupeKey: `notif:${inserted[0].id}` });
  }
}

export async function resolveTemplate(exec: Executor, key: string, channel: Channel) {
  const row = await exec.query.notificationTemplates.findFirst({
    where: and(eq(schema.notificationTemplates.key, key), eq(schema.notificationTemplates.channel, channel)),
  });
  if (row) return row.isActive ? { subject: row.subject ?? undefined, body: row.body } : null;
  return DEFAULT_TEMPLATES[key]?.[channel] ?? null;
}

export async function unreadStaffAlerts(limit = 8) {
  return db.query.notifications.findMany({
    where: (n, { and, eq, isNull }) => and(eq(n.channel, "STAFF"), isNull(n.readAt)),
    orderBy: (n, { desc }) => desc(n.createdAt),
    limit,
  });
}
