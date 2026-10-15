import Link from "next/link";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireStaffPage } from "@/lib/auth/server";
import { methodLabel } from "@/lib/documents";
import { presetRange } from "@/lib/reports";
import { maskPhone } from "@/lib/text";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, fmtDate, Money, PageHeader } from "@/components/ui";
import { reconcileNowAction } from "./actions";

export const metadata = { title: "Payments" };

const TABS = [["received", "Payments received"], ["requests", "M-Pesa requests"], ["refunds", "Refunds"], ["callbacks", "Callback log"]] as const;

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ tab?: string; range?: string; from?: string; to?: string; status?: string }> }) {
  await requireStaffPage("payments.reconcile", "/admin/payments");
  const sp = await searchParams;
  const tab = TABS.find(([k]) => k === sp.tab)?.[0] ?? "received";
  const r = presetRange(sp.range ?? "7d", sp.from, sp.to);
  const issues = await db.execute<{ n: number }>(sql`select count(*)::int as n from payment_attempts where (status = 'PENDING' and created_at < now() - interval '10 minutes') or result_desc like 'Amount mismatch%' or result_desc = 'Confirmed by query; awaiting receipt number'`);
  return (
    <>
      <PageHeader
        title="Payments"
        description="Every payment, M-Pesa request and refund. Orders are only marked paid from confirmed M-Pesa results or payments recorded by authorised staff."
        actions={<ActionForm action={reconcileNowAction}><SubmitButton className="btn-secondary">Re-check pending M-Pesa requests</SubmitButton></ActionForm>}
      />
      {Number(issues.rows[0].n) ? <p className="mb-4 rounded bg-warn-100 px-3 py-2 text-sm text-warn">{issues.rows[0].n} M-Pesa request(s) need a look: no answer after 10 minutes, a different amount paid, or confirmed without a receipt number. <Link className="link" href="/admin/payments?tab=requests&status=attention">Show them</Link></p> : null}
      <nav className="mb-4 flex flex-wrap gap-2">
        {TABS.map(([k, l]) => <Link key={k} href={`?tab=${k}`} className={`btn-sm btn ${tab === k ? "bg-plum text-white" : "btn-secondary"}`}>{l}</Link>)}
      </nav>
      {tab === "received" ? <Received r={r} /> : tab === "requests" ? <Requests status={sp.status} /> : tab === "refunds" ? <Refunds /> : <Callbacks />}
    </>
  );
}

async function Received({ r }: { r: { from: Date; to: Date; label: string } }) {
  const rows = await db
    .select({ p: schema.payments, number: schema.orders.number, orderId: schema.orders.id, by: schema.users.name })
    .from(schema.payments)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.payments.orderId))
    .leftJoin(schema.users, eq(schema.users.id, schema.payments.recordedById))
    .where(and(gte(schema.payments.receivedAt, r.from), lt(schema.payments.receivedAt, r.to)))
    .orderBy(desc(schema.payments.receivedAt))
    .limit(500);
  const byMethod = new Map<string, number>();
  for (const x of rows) if (x.p.status === "SUCCEEDED") byMethod.set(x.p.method, (byMethod.get(x.p.method) ?? 0) + x.p.amountCents);
  return (
    <>
      <form className="mb-3 flex flex-wrap gap-2 text-sm">
        <input type="hidden" name="tab" value="received" />
        {[["today", "Today"], ["7d", "7 days"], ["30d", "30 days"], ["month", "This month"]].map(([k, l]) => <Link key={k} className="btn-secondary btn-sm" href={`?tab=received&range=${k}`}>{l}</Link>)}
        <input className="input input-sm w-auto" type="date" name="from" aria-label="From" />
        <input className="input input-sm w-auto" type="date" name="to" aria-label="To" />
        <button className="btn-secondary btn-sm">Apply</button>
      </form>
      <p className="mb-3 text-sm">{r.label}: {[...byMethod.entries()].map(([m, t]) => <span key={m} className="mr-4">{methodLabel(m)} <strong><Money cents={t} /></strong></span>)}{byMethod.size === 0 ? "no payments" : null}</p>
      <div className="card overflow-x-auto">
        <table className="table">
          <thead><tr><th>When</th><th>Order</th><th>Method</th><th>Reference</th><th>Recorded by</th><th className="text-right">Amount</th></tr></thead>
          <tbody>
            {rows.map(({ p, number, orderId, by }) => (
              <tr key={p.id}>
                <td className="whitespace-nowrap">{fmtDate(p.receivedAt, true)}</td>
                <td><Link className="link" href={`/admin/orders/${orderId}`}>{number}</Link></td>
                <td>{methodLabel(p.method)}</td>
                <td>{p.reference ?? "—"}</td>
                <td>{by ?? (p.attemptId ? "M-Pesa confirmation" : "—")}</td>
                <td className="text-right"><Money cents={p.amountCents} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

async function Requests({ status }: { status?: string }) {
  const where =
    status === "attention"
      ? sql`(${schema.paymentAttempts.status} = 'PENDING' and ${schema.paymentAttempts.createdAt} < now() - interval '10 minutes') or ${schema.paymentAttempts.resultDesc} like 'Amount mismatch%' or ${schema.paymentAttempts.resultDesc} = 'Confirmed by query; awaiting receipt number'`
      : status
        ? eq(schema.paymentAttempts.status, status as "PENDING")
        : undefined;
  const rows = await db
    .select({ a: schema.paymentAttempts, number: schema.orders.number, orderId: schema.orders.id })
    .from(schema.paymentAttempts)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.paymentAttempts.orderId))
    .where(where)
    .orderBy(desc(schema.paymentAttempts.createdAt))
    .limit(200);
  return (
    <>
      <div className="mb-3 flex flex-wrap gap-2 text-sm">
        {[["", "All"], ["PENDING", "Waiting"], ["SUCCEEDED", "Paid"], ["FAILED", "Failed"], ["CANCELLED", "Cancelled by customer"], ["EXPIRED", "Timed out"], ["attention", "Needs attention"]].map(([k, l]) => <Link key={k} className="btn-secondary btn-sm" href={`?tab=requests${k ? `&status=${k}` : ""}`}>{l}</Link>)}
      </div>
      <div className="card overflow-x-auto">
        <table className="table">
          <thead><tr><th>Sent</th><th>Order</th><th>Phone</th><th>Status</th><th>Result</th><th>Receipt</th><th className="text-right">Amount</th></tr></thead>
          <tbody>
            {rows.map(({ a, number, orderId }) => (
              <tr key={a.id}>
                <td className="whitespace-nowrap">{fmtDate(a.createdAt, true)}</td>
                <td><Link className="link" href={`/admin/orders/${orderId}`}>{number}</Link></td>
                <td>{maskPhone(a.phone)}</td>
                <td><Badge tone={a.status === "SUCCEEDED" ? "ok" : a.status === "PENDING" ? "warn" : "bad"}>{a.status.toLowerCase()}</Badge></td>
                <td className="text-[13px]">{a.resultDesc ?? "—"}</td>
                <td>{a.providerReceipt ?? "—"}</td>
                <td className="text-right"><Money cents={a.amountCents} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

async function Refunds() {
  const rows = await db
    .select({ r: schema.refunds, number: schema.orders.number, orderId: schema.orders.id, by: schema.users.name })
    .from(schema.refunds)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.refunds.orderId))
    .leftJoin(schema.users, eq(schema.users.id, schema.refunds.createdById))
    .orderBy(sql`${schema.refunds.status} = 'PENDING_PAYOUT' desc`, desc(schema.refunds.createdAt))
    .limit(200);
  return (
    <div className="card overflow-x-auto">
      <table className="table">
        <thead><tr><th>Date</th><th>Credit note</th><th>Order</th><th>Method</th><th>Status</th><th>By</th><th>Reason</th><th className="text-right">Amount</th></tr></thead>
        <tbody>
          {rows.map(({ r, number, orderId, by }) => (
            <tr key={r.id}>
              <td className="whitespace-nowrap">{fmtDate(r.createdAt, true)}</td>
              <td>{r.number}</td>
              <td><Link className="link" href={`/admin/orders/${orderId}`}>{number}</Link></td>
              <td>{methodLabel(r.method)}{r.reference ? ` · ${r.reference}` : ""}</td>
              <td>{r.status === "PENDING_PAYOUT" ? <Badge tone="warn">to pay out</Badge> : <Badge tone="ok">paid out</Badge>}</td>
              <td>{by}</td>
              <td className="text-[13px]">{r.reason}</td>
              <td className="text-right"><Money cents={r.amountCents} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function Callbacks() {
  const rows = await db.select().from(schema.paymentCallbackLogs).orderBy(desc(schema.paymentCallbackLogs.receivedAt)).limit(100);
  return (
    <div className="card overflow-x-auto">
      <table className="table">
        <thead><tr><th>Received</th><th>Source</th><th>Checkout request</th><th>Outcome</th></tr></thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              <td className="whitespace-nowrap">{fmtDate(c.receivedAt, true)}</td>
              <td>{c.provider}</td>
              <td className="text-[12px]">{c.checkoutRequestId}</td>
              <td><Badge tone={c.outcome?.startsWith("processed") ? "ok" : c.outcome?.startsWith("duplicate") ? "neutral" : "warn"}>{c.outcome}</Badge></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
