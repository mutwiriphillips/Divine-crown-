import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireStaffPage } from "@/lib/auth/server";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, EmptyState, fmtDate, PageHeader } from "@/components/ui";
import { Stars } from "@/components/shop/stars";
import { answerQuestionAction, moderateReviewAction } from "./actions";

export const metadata = { title: "Reviews & questions" };
const TYPE: Record<string, string> = { PRODUCT: "Product", EXPERIENCE: "Shopping experience", DELIVERY: "Delivery", SUPPORT: "Support" };

export default async function FeedbackPage({ searchParams }: { searchParams: Promise<{ tab?: string; status?: string }> }) {
  await requireStaffPage("feedback.moderate", "/admin/feedback");
  const sp = await searchParams;
  const tab = sp.tab === "questions" ? "questions" : sp.tab === "insights" ? "insights" : "reviews";
  return (
    <>
      <PageHeader title="Reviews & questions" description="Reviews appear in the shop only after approval. You can reply publicly, but you can't change what a customer wrote or the stars they gave." />
      <nav className="mb-4 flex gap-2">
        {[["reviews", "Reviews"], ["questions", "Questions"], ["insights", "Trends"]].map(([k, l]) => <Link key={k} className={`btn-sm btn ${tab === k ? "bg-plum text-white" : "btn-secondary"}`} href={`?tab=${k}`}>{l}</Link>)}
      </nav>
      {tab === "reviews" ? <Reviews status={sp.status} /> : tab === "questions" ? <Questions /> : <Insights />}
    </>
  );
}

async function Reviews({ status }: { status?: string }) {
  const st = (status ?? "PENDING") as "PENDING";
  const rows = await db.query.reviews.findMany({
    where: status === "ALL" ? undefined : st === "PENDING" ? sql`${schema.reviews.status} in ('PENDING','FLAGGED')` : eq(schema.reviews.status, st),
    orderBy: desc(schema.reviews.createdAt),
    with: { product: { columns: { name: true, slug: true } }, reports: true, order: { columns: { number: true } } },
    limit: 100,
  });
  return (
    <>
      <div className="mb-3 flex gap-2 text-sm">
        {[["PENDING", "To moderate"], ["APPROVED", "Approved"], ["REJECTED", "Rejected"], ["ALL", "All"]].map(([k, l]) => <Link key={k} className="btn-secondary btn-sm" href={`?tab=reviews&status=${k}`}>{l}</Link>)}
      </div>
      {rows.length === 0 ? <EmptyState title="Nothing here">No reviews in this list.</EmptyState> : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.id} className="card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Stars value={r.rating} />
                <Badge tone={r.status === "APPROVED" ? "ok" : r.status === "REJECTED" ? "neutral" : r.status === "FLAGGED" ? "bad" : "warn"}>{r.status.toLowerCase()}</Badge>
                <span className="text-sm text-ink-soft">{TYPE[r.type]}{r.product ? <> · <Link className="link" href={`/products/${r.product.slug}`}>{r.product.name}</Link></> : null}{r.order ? ` · ${r.order.number}` : ""} · {r.displayName}{r.verifiedPurchase ? " · verified purchase" : ""} · {fmtDate(r.createdAt, true)}</span>
              </div>
              {r.title ? <p className="mt-2 font-semibold">{r.title}</p> : null}
              {r.body ? <p className="mt-1 whitespace-pre-line">{r.body}</p> : null}
              {r.reports.length ? <p className="mt-2 text-sm text-bad">Reported {r.reports.length}×: {r.reports.map((x) => x.reason).join("; ")}</p> : null}
              <div className="mt-3 flex flex-wrap gap-2">
                {r.status !== "APPROVED" ? <ActionForm action={moderateReviewAction}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="op" value="approve" /><SubmitButton className="btn-primary btn-sm">Approve</SubmitButton></ActionForm> : null}
                {r.status !== "REJECTED" ? (
                  <ActionForm action={moderateReviewAction} className="flex gap-1">
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="op" value="reject" />
                    <input className="input input-sm" name="note" placeholder="Why reject? (staff only)" aria-label="Reason" />
                    <SubmitButton className="btn-secondary btn-sm">Reject</SubmitButton>
                  </ActionForm>
                ) : null}
              </div>
              <ActionForm action={moderateReviewAction} className="mt-2 flex gap-2">
                <input type="hidden" name="id" value={r.id} />
                <input type="hidden" name="op" value="respond" />
                <input className="input input-sm" name="response" defaultValue={r.adminResponse ?? ""} placeholder="Public reply (optional)" aria-label="Public reply" />
                <SubmitButton className="btn-secondary btn-sm">Save reply</SubmitButton>
              </ActionForm>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

async function Questions() {
  const rows = await db.query.productQuestions.findMany({ orderBy: [sql`${schema.productQuestions.status} = 'PENDING' desc`, desc(schema.productQuestions.createdAt)], with: { product: { columns: { name: true } } }, limit: 100 });
  if (!rows.length) return <EmptyState title="No questions yet">Questions customers ask on product pages appear here.</EmptyState>;
  return (
    <ul className="space-y-3">
      {rows.map((q) => (
        <li key={q.id} className="card p-4">
          <p className="text-sm text-ink-soft">{q.product.name} · {q.askerName} · {fmtDate(q.createdAt, true)} · <Badge tone={q.status === "PUBLISHED" ? "ok" : q.status === "HIDDEN" ? "neutral" : "warn"}>{q.status.toLowerCase()}</Badge></p>
          <p className="mt-1 font-semibold">{q.question}</p>
          <ActionForm action={answerQuestionAction} className="mt-2 flex gap-2">
            <input type="hidden" name="id" value={q.id} />
            <input className="input input-sm" name="answer" defaultValue={q.answer ?? ""} placeholder="Answer (published on the product page)" aria-label="Answer" />
            <SubmitButton className="btn-primary btn-sm">Publish answer</SubmitButton>
          </ActionForm>
          {q.status !== "HIDDEN" ? <ActionForm action={answerQuestionAction} className="mt-1"><input type="hidden" name="id" value={q.id} /><input type="hidden" name="op" value="hide" /><SubmitButton className="btn-ghost btn-sm">Hide</SubmitButton></ActionForm> : null}
        </li>
      ))}
    </ul>
  );
}

async function Insights() {
  const [byType, lowProducts, complaints] = await Promise.all([
    db.execute<{ type: string; n: number; avg: number; low: number }>(sql`select type, count(*)::int as n, avg(rating)::numeric(3,2) as avg, count(*) filter (where rating <= 2)::int as low from reviews where created_at > now() - interval '90 days' and status <> 'REJECTED' group by type`),
    db.execute<{ name: string; n: number; avg: number }>(sql`select p.name, count(*)::int as n, avg(r.rating)::numeric(3,2) as avg from reviews r join products p on p.id = r.product_id where r.created_at > now() - interval '180 days' and r.status <> 'REJECTED' group by p.name having avg(r.rating) < 3.5 order by avg asc limit 10`),
    db.execute<{ category: string; n: number; open: number }>(sql`select category, count(*)::int as n, count(*) filter (where status in ('OPEN','IN_PROGRESS'))::int as open from support_tickets where created_at > now() - interval '90 days' group by category order by n desc`),
  ]);
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <section className="card p-5">
        <h2 className="mb-3 text-lg">Ratings, last 90 days</h2>
        <ul className="space-y-2 text-sm">{byType.rows.map((t) => <li key={t.type}>{TYPE[t.type]}: <strong>{t.avg}</strong> average from {t.n} · {t.low} low (1–2★)</li>)}{!byType.rows.length ? <li className="text-ink-soft">No ratings yet.</li> : null}</ul>
      </section>
      <section className="card p-5">
        <h2 className="mb-3 text-lg">Products with low ratings</h2>
        <ul className="space-y-2 text-sm">{lowProducts.rows.map((p) => <li key={p.name}>{p.name}: {p.avg} from {p.n} review(s)</li>)}{!lowProducts.rows.length ? <li className="text-ink-soft">None below 3.5★.</li> : null}</ul>
      </section>
      <section className="card p-5">
        <h2 className="mb-3 text-lg">Support requests, last 90 days</h2>
        <ul className="space-y-2 text-sm">{complaints.rows.map((c) => <li key={c.category}>{c.category.replace(/_/g, " ").toLowerCase()}: {c.n} ({c.open} open)</li>)}{!complaints.rows.length ? <li className="text-ink-soft">None.</li> : null}</ul>
      </section>
    </div>
  );
}
