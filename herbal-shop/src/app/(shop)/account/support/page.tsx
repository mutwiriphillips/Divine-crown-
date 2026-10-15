import Link from "next/link";
import { asc, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { currentCustomerId } from "@/lib/cart";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, fmtDate } from "@/components/ui";
import { customerReplyTicketAction, rateSupportAction } from "../actions";

export const metadata = { title: "Messages" };

export default async function AccountSupport() {
  const cid = await currentCustomerId();
  const tickets = cid
    ? await db.query.supportTickets.findMany({
        where: eq(schema.supportTickets.customerId, cid),
        orderBy: desc(schema.supportTickets.updatedAt),
        with: { messages: { where: (m, { eq }) => eq(m.internal, false), orderBy: (m) => asc(m.createdAt) } },
      })
    : [];
  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <h2 className="text-2xl">Messages</h2>
        <Link className="btn-secondary btn-sm" href="/support">New message</Link>
      </div>
      {tickets.length === 0 ? <p className="text-ink-soft">No messages yet.</p> : null}
      {tickets.map((t) => (
        <details key={t.id} className="card p-4" open={t.status !== "CLOSED"}>
          <summary className="flex cursor-pointer flex-wrap items-center gap-2">
            <span className="font-semibold">{t.subject}</span>
            <Badge tone={t.status === "RESOLVED" || t.status === "CLOSED" ? "ok" : "warn"}>{t.status === "OPEN" ? "Waiting for us" : t.status === "IN_PROGRESS" ? "In progress" : t.status === "RESOLVED" ? "Resolved" : "Closed"}</Badge>
            <span className="text-sm text-ink-soft">{t.number}</span>
          </summary>
          <ul className="mt-3 space-y-3">
            {t.messages.map((m) => (
              <li key={m.id} className={`rounded px-3 py-2 ${m.fromCustomer ? "bg-ivory-200/60" : "bg-plum-50"}`}>
                <p className="text-[13px] text-ink-soft">{m.fromCustomer ? "You" : "The shop"} · {fmtDate(m.createdAt, true)}</p>
                <p className="whitespace-pre-line">{m.body}</p>
              </li>
            ))}
          </ul>
          {t.resolution ? <p className="mt-3 text-sm"><strong>Resolution:</strong> {t.resolution}</p> : null}
          <ActionForm action={customerReplyTicketAction} className="mt-3 flex gap-2" resetOnSuccess>
            <input type="hidden" name="ticketId" value={t.id} />
            <input className="input" name="body" placeholder="Write a reply" aria-label="Reply" />
            <SubmitButton className="btn-secondary">Send</SubmitButton>
          </ActionForm>
          {t.status === "RESOLVED" && !t.satisfaction ? (
            <ActionForm action={rateSupportAction} className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <input type="hidden" name="ticketId" value={t.id} />
              <span>How happy are you with our help?</span>
              {[1, 2, 3, 4, 5].map((n) => (
                <SubmitButton key={n} className="btn-ghost btn-sm" name="satisfaction" value={String(n)}>{`${n}★`}</SubmitButton>
              ))}
            </ActionForm>
          ) : null}
        </details>
      ))}
    </div>
  );
}
