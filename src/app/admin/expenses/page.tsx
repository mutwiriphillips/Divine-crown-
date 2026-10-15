import Link from "next/link";
import { and, asc, desc, eq, gte, lt, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireStaffPage } from "@/lib/auth/server";
import { methodLabel } from "@/lib/documents";
import { presetRange } from "@/lib/reports";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, fmtDate, Money, PageHeader } from "@/components/ui";
import { createExpenseAction, expenseCategoryAction, reviewExpenseAction } from "./actions";

export const metadata = { title: "Expenses" };

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<{ range?: string; from?: string; to?: string; status?: string; category?: string }> }) {
  const user = await requireStaffPage("expenses.create", "/admin/expenses");
  const sp = await searchParams;
  const r = presetRange(sp.range ?? "month", sp.from, sp.to);
  const conds: SQL[] = [gte(schema.expenses.date, r.from), lt(schema.expenses.date, r.to)];
  if (sp.status) conds.push(eq(schema.expenses.status, sp.status as "APPROVED"));
  if (sp.category) conds.push(eq(schema.expenses.categoryId, sp.category));
  const canApprove = user.permissions.includes("expenses.approve");
  if (!canApprove) conds.push(eq(schema.expenses.createdById, user.id));
  const [rows, cats, suppliers] = await Promise.all([
    db.select({ e: schema.expenses, cat: schema.expenseCategories.name, by: schema.users.name }).from(schema.expenses).innerJoin(schema.expenseCategories, eq(schema.expenseCategories.id, schema.expenses.categoryId)).leftJoin(schema.users, eq(schema.users.id, schema.expenses.createdById)).where(and(...conds)).orderBy(desc(schema.expenses.date)),
    db.select().from(schema.expenseCategories).where(eq(schema.expenseCategories.isActive, true)).orderBy(asc(schema.expenseCategories.name)),
    db.select({ id: schema.suppliers.id, name: schema.suppliers.name }).from(schema.suppliers).orderBy(asc(schema.suppliers.name)),
  ]);
  const byCat = new Map<string, number>();
  let approved = 0;
  for (const x of rows) if (x.e.status === "APPROVED") { byCat.set(x.cat, (byCat.get(x.cat) ?? 0) + x.e.amountCents); approved += x.e.amountCents; }
  const qs = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]).toString();
  return (
    <>
      <PageHeader title="Expenses" description={`${r.label}: approved expenses total ${(approved / 100).toLocaleString("en-KE", { style: "currency", currency: "KES" })}. Submitted expenses aren't counted until approved.`} actions={<a className="btn-secondary" href={`/admin/expenses/export?${qs}`}>Export CSV</a>} />
      <form className="mb-4 flex flex-wrap gap-2 text-sm">
        {[["month", "This month"], ["30d", "30 days"], ["year", "This year"]].map(([k, l]) => <Link key={k} className="btn-secondary btn-sm" href={`?range=${k}`}>{l}</Link>)}
        <input className="input input-sm w-auto" type="date" name="from" defaultValue={sp.from} aria-label="From" />
        <input className="input input-sm w-auto" type="date" name="to" defaultValue={sp.to} aria-label="To" />
        <select className="input input-sm w-auto" name="status" defaultValue={sp.status ?? ""} aria-label="Status"><option value="">Any status</option><option value="SUBMITTED">Waiting for approval</option><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option></select>
        <select className="input input-sm w-auto" name="category" defaultValue={sp.category ?? ""} aria-label="Category"><option value="">All categories</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <button className="btn-secondary btn-sm">Filter</button>
      </form>
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          {byCat.size ? (
            <section className="card p-5">
              <h2 className="mb-3 text-lg">By category (approved)</h2>
              <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">{[...byCat.entries()].sort((a, b) => b[1] - a[1]).map(([c, t]) => <li key={c} className="flex justify-between"><span>{c}</span><Money cents={t} /></li>)}</ul>
            </section>
          ) : null}
          <div className="card overflow-x-auto">
            <table className="table">
              <thead><tr><th>Date</th><th>Description</th><th>Category</th><th>Paid by</th><th>Status</th><th className="text-right">Amount</th></tr></thead>
              <tbody>
                {rows.map(({ e, cat, by }) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap">{fmtDate(e.date)}</td>
                    <td>{e.description}<span className="block text-[12px] text-ink-soft">{e.payee ?? ""}{e.reference ? ` · ref ${e.reference}` : ""} · by {by}{e.posSessionId ? " · from till" : ""}{e.isDemo ? " · sample" : ""}</span>
                      {e.attachmentKey ? <a className="link text-[12px]" href={`/admin/expenses/attachment/${e.id}`}>View receipt</a> : null}
                    </td>
                    <td>{cat}</td>
                    <td>{methodLabel(e.paymentMethod)}</td>
                    <td>
                      <Badge tone={e.status === "APPROVED" ? "ok" : e.status === "REJECTED" ? "neutral" : "warn"}>{e.status === "SUBMITTED" ? "waiting" : e.status.toLowerCase()}</Badge>
                      {e.rejectionNote ? <span className="block text-[12px] text-ink-soft">{e.rejectionNote}</span> : null}
                      {canApprove && e.status === "SUBMITTED" ? (
                        <span className="mt-1 flex gap-1">
                          <ActionForm action={reviewExpenseAction}><input type="hidden" name="id" value={e.id} /><input type="hidden" name="op" value="approve" /><SubmitButton className="btn-primary btn-sm">Approve</SubmitButton></ActionForm>
                          <ActionForm action={reviewExpenseAction} className="flex gap-1"><input type="hidden" name="id" value={e.id} /><input type="hidden" name="op" value="reject" /><input className="input input-sm w-28" name="note" placeholder="Why?" aria-label="Reason" /><SubmitButton className="btn-ghost btn-sm">Reject</SubmitButton></ActionForm>
                        </span>
                      ) : null}
                    </td>
                    <td className="text-right"><Money cents={e.amountCents} /></td>
                  </tr>
                ))}
                {rows.length === 0 ? <tr><td colSpan={6} className="text-ink-soft">No expenses in this period.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </div>
        <aside className="space-y-4">
          <ActionForm action={createExpenseAction} className="card space-y-3 p-5" resetOnSuccess>
            <h2 className="text-lg">Record an expense</h2>
            <input className="input" name="description" placeholder="What was it for?" required aria-label="Description" />
            <div className="grid grid-cols-2 gap-2">
              <input className="input" name="amount" inputMode="decimal" placeholder="Amount (KES)" required aria-label="Amount" />
              <input className="input" type="date" name="date" aria-label="Date" />
            </div>
            <select className="input" name="categoryId" required aria-label="Category">{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            <select className="input" name="paymentMethod" defaultValue="MPESA" aria-label="Paid by"><option value="MPESA">M-Pesa</option><option value="CASH">Cash</option><option value="BANK_TRANSFER">Bank transfer</option><option value="CARD">Card</option><option value="OTHER">Other</option></select>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="checkbox" name="fromTill" /> Cash taken from my open till</label>
            <input className="input" name="payee" placeholder="Paid to" aria-label="Payee" />
            <select className="input" name="supplierId" defaultValue="" aria-label="Supplier"><option value="">Not a stock supplier</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            <input className="input" name="reference" placeholder="Reference (e.g. M-Pesa code)" aria-label="Reference" />
            <label className="block text-sm">Receipt photo or PDF (optional)<input className="mt-1 block text-sm" type="file" name="attachment" accept="image/jpeg,image/png,image/webp,application/pdf" /></label>
            <SubmitButton>Save expense</SubmitButton>
            {!canApprove ? <p className="text-[13px] text-ink-soft">A manager approves expenses before they count in reports.</p> : null}
          </ActionForm>
          {canApprove ? (
            <ActionForm action={expenseCategoryAction} className="card flex gap-2 p-4" resetOnSuccess>
              <input className="input input-sm" name="name" placeholder="New category" aria-label="New category" />
              <SubmitButton className="btn-secondary btn-sm">Add</SubmitButton>
            </ActionForm>
          ) : null}
        </aside>
      </div>
    </>
  );
}
