import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireStaffPage } from "@/lib/auth/server";
import { DEFAULT_TEMPLATES } from "@/lib/notifications/templates";
import { channelConfigured } from "@/lib/notifications/providers";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, fmtDate, Notice, PageHeader } from "@/components/ui";
import { resendNotificationAction, saveTemplateAction } from "../actions";

export const metadata = { title: "Notifications" };

const NAMES: Record<string, string> = {
  "order.placed": "Order received", "payment.received": "Payment received", "payment.failed": "Payment failed", "order.status": "Order status update",
  "order.cancelled": "Order cancelled", "refund.issued": "Refund issued", "auth.password_reset": "Password reset", "order.access_link": "Order link (guest lookup)",
  "ticket.update": "Support reply", "cart.reminder": "Cart reminder (marketing)", "staff.low_stock": "Low stock (staff)", "staff.daily_summary": "Daily summary (staff)",
};

export default async function NotificationsPage() {
  await requireStaffPage("notifications.manage", "/admin/settings/notifications");
  const [overrides, recent] = await Promise.all([
    db.select().from(schema.notificationTemplates),
    db.select().from(schema.notifications).where(eq(schema.notifications.channel, schema.notifications.channel)).orderBy(desc(schema.notifications.createdAt)).limit(40),
  ]);
  const channels = ["EMAIL", "SMS", "WHATSAPP"] as const;
  return (
    <>
      <PageHeader title="Notifications" description="Messages sent to customers and staff. Placeholders in {{double braces}} are filled in automatically." />
      <div className="mb-6 flex flex-wrap gap-2">
        {channels.map((c) => <Badge key={c} tone={channelConfigured(c) ? "ok" : "warn"}>{c.toLowerCase()}: {channelConfigured(c) ? "connected" : "not connected"}</Badge>)}
      </div>
      {!channelConfigured("EMAIL") ? <div className="mb-6"><Notice>Email isn&apos;t connected yet, so customer emails are recorded below as “skipped” instead of being sent. See Integrations for what&apos;s needed.</Notice></div> : null}
      <section className="mb-8 space-y-3">
        {Object.entries(DEFAULT_TEMPLATES).filter(([k]) => NAMES[k]).map(([key, chans]) => (
          <details key={key} className="card p-4">
            <summary className="cursor-pointer font-semibold">{NAMES[key]}</summary>
            <div className="mt-3 grid gap-4 lg:grid-cols-2">
              {Object.entries(chans).filter(([ch]) => ch !== "STAFF").map(([ch, def]) => {
                const o = overrides.find((x) => x.key === key && x.channel === ch);
                return (
                  <ActionForm key={ch} action={saveTemplateAction} className="space-y-2 rounded border border-line bg-white p-3">
                    <input type="hidden" name="key" value={key} />
                    <input type="hidden" name="channel" value={ch} />
                    <p className="text-sm font-semibold">{ch.toLowerCase()}{o ? " · edited" : ""}</p>
                    {ch === "EMAIL" ? <input className="input input-sm" name="subject" defaultValue={o?.subject ?? def?.subject ?? ""} aria-label="Subject" /> : null}
                    <textarea className="input min-h-[110px] text-sm" name="body" defaultValue={o?.body ?? def?.body ?? ""} aria-label="Message" />
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="checkbox" name="isActive" defaultChecked={o?.isActive ?? true} /> Send this message</label>
                    <SubmitButton className="btn-secondary btn-sm">Save</SubmitButton>
                  </ActionForm>
                );
              })}
            </div>
          </details>
        ))}
      </section>
      <h2 className="mb-3 text-xl">Recent messages</h2>
      <div className="card overflow-x-auto">
        <table className="table">
          <thead><tr><th>When</th><th>Message</th><th>Channel</th><th>To</th><th>Status</th><th /></tr></thead>
          <tbody>
            {recent.map((n) => (
              <tr key={n.id}>
                <td className="whitespace-nowrap">{fmtDate(n.createdAt, true)}</td>
                <td>{NAMES[n.templateKey] ?? n.templateKey}</td>
                <td>{n.channel.toLowerCase()}</td>
                <td>{n.channel === "STAFF" ? "Staff" : n.recipient.replace(/(.{3}).+(.{3})/, "$1•••$2")}</td>
                <td>
                  <Badge tone={n.status === "SENT" ? "ok" : n.status === "FAILED" ? "bad" : "warn"}>{n.status.toLowerCase()}</Badge>
                  {n.skipReason || n.lastError ? <span className="block text-[12px] text-ink-soft">{n.skipReason ?? n.lastError}</span> : null}
                </td>
                <td>{n.status === "FAILED" || n.status === "SKIPPED" ? <ActionForm action={resendNotificationAction}><input type="hidden" name="id" value={n.id} /><SubmitButton className="btn-ghost btn-sm">Send again</SubmitButton></ActionForm> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
