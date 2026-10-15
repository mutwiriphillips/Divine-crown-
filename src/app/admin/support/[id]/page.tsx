import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireStaffPage } from "@/lib/auth/server";
import { maskEmail, maskPhone } from "@/lib/text";
import { ActionForm, SubmitButton } from "@/components/forms";
import { fmtDate, PageHeader } from "@/components/ui";
import { ticketReplyAction, ticketUpdateAction } from "../actions";

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireStaffPage("support.manage", `/admin/support/${id}`);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const t = await db.query.supportTickets.findFirst({ where: eq(schema.supportTickets.id, id), with: { messages: { orderBy: (m) => asc(m.createdAt) }, order: true } });
  if (!t) notFound();
  const staff = await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).innerJoin(schema.roles, eq(schema.roles.id, schema.users.roleId)).where(and(eq(schema.roles.isStaff, true), eq(schema.users.status, "ACTIVE")));
  const seeContact = user.permissions.includes("customers.view_contact");
  return (
    <>
      <p className="mb-2 text-sm"><Link className="link" href="/admin/support">Support requests</Link></p>
      <PageHeader title={t.subject} description={`${t.number} · ${t.category.replace(/_/g, " ").toLowerCase()} · from ${t.contactName} (${seeContact ? t.contactPhone ?? t.contactEmail : maskPhone(t.contactPhone) || maskEmail(t.contactEmail)})`} />
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <section className="card p-5">
          <ul className="space-y-3">
            {t.messages.map((m) => (
              <li key={m.id} className={`rounded px-3 py-2 ${m.internal ? "border border-dashed border-warn bg-warn-100/50" : m.fromCustomer ? "bg-ivory-200/60" : "bg-plum-50"}`}>
                <p className="text-[12px] text-ink-soft">{m.internal ? "Staff note" : m.fromCustomer ? t.contactName : `Reply by ${staff.find((s) => s.id === m.authorId)?.name ?? "staff"}`} · {fmtDate(m.createdAt, true)}</p>
                <p className="whitespace-pre-line">{m.body}</p>
              </li>
            ))}
          </ul>
          <ActionForm action={ticketReplyAction} className="mt-4 space-y-2" resetOnSuccess>
            <input type="hidden" name="ticketId" value={t.id} />
            <textarea className="input min-h-[100px]" name="body" placeholder="Write a reply…" aria-label="Reply" />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="checkbox" name="internal" /> Staff note only (not sent to the customer)</label>
            <SubmitButton>Send</SubmitButton>
          </ActionForm>
        </section>
        <aside className="space-y-4">
          <ActionForm action={ticketUpdateAction} className="card space-y-3 p-5">
            <input type="hidden" name="ticketId" value={t.id} />
            <label className="field-label" htmlFor="status">Status</label>
            <select className="input" id="status" name="status" defaultValue={t.status}><option value="OPEN">Open</option><option value="IN_PROGRESS">In progress</option><option value="RESOLVED">Resolved</option><option value="CLOSED">Closed</option></select>
            <label className="field-label" htmlFor="priority">Priority</label>
            <select className="input" id="priority" name="priority" defaultValue={String(t.priority)}><option value="1">High</option><option value="2">Normal</option><option value="3">Low</option></select>
            <label className="field-label" htmlFor="assignedToId">Assigned to</label>
            <select className="input" id="assignedToId" name="assignedToId" defaultValue={t.assignedToId ?? ""}><option value="">Nobody</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            <label className="field-label" htmlFor="resolution">Resolution</label>
            <textarea className="input" id="resolution" name="resolution" defaultValue={t.resolution ?? ""} placeholder="Needed to resolve or close" />
            <SubmitButton>Save</SubmitButton>
          </ActionForm>
          {t.order ? <p className="card p-4 text-sm">Order <Link className="link" href={`/admin/orders/${t.order.id}`}>{t.order.number}</Link></p> : null}
          {t.satisfaction ? <p className="card p-4 text-sm">Customer rated our help {t.satisfaction}/5</p> : null}
        </aside>
      </div>
    </>
  );
}
