import { desc } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireStaffPage } from "@/lib/auth/server";
import { fmtDate, Notice, PageHeader } from "@/components/ui";

export const metadata = { title: "Newsletter" };

export default async function NewsletterPage() {
  const user = await requireStaffPage("promotions.manage", "/admin/promotions/newsletter");
  const subs = await db.select().from(schema.newsletterSubscribers).orderBy(desc(schema.newsletterSubscribers.consentAt)).limit(1000);
  const active = subs.filter((s) => !s.unsubscribedAt);
  return (
    <>
      <PageHeader title="Newsletter subscribers" description={`${active.length} subscribed. Each person ticked a consent box; the wording and time are recorded.`} actions={user.permissions.includes("customers.export") ? <a className="btn-secondary" href="/admin/promotions/newsletter/export">Export subscribers (CSV)</a> : null} />
      <div className="mb-4"><Notice tone="plum">Sending newsletters isn&apos;t built in. Export this list into your email tool (e.g. Mailchimp or Brevo), and include each person&apos;s unsubscribe link: {process.env.APP_URL ?? ""}/unsubscribe?token=…</Notice></div>
      <div className="card overflow-x-auto">
        <table className="table">
          <thead><tr><th>Email</th><th>Signed up</th><th>Source</th><th>Status</th></tr></thead>
          <tbody>{subs.map((s) => <tr key={s.id}><td>{s.email}</td><td>{fmtDate(s.consentAt, true)}</td><td>{s.source}</td><td>{s.unsubscribedAt ? `Unsubscribed ${fmtDate(s.unsubscribedAt)}` : "Subscribed"}</td></tr>)}</tbody>
        </table>
      </div>
    </>
  );
}
