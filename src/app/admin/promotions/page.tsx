import Link from "next/link";
import { asc, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireStaffPage } from "@/lib/auth/server";
import { formatKES } from "@/lib/money";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, fmtDate, PageHeader } from "@/components/ui";
import { bannerAction, promotionAction } from "./actions";

export const metadata = { title: "Promotions" };

export default async function PromotionsPage() {
  await requireStaffPage("promotions.manage", "/admin/promotions");
  const [promos, banners, products, cats, subs] = await Promise.all([
    db.select({ p: schema.promotions, revenue: sql<number>`(select coalesce(sum(amount_cents),0)::int from promotion_redemptions r where r.promotion_id = ${schema.promotions.id})` }).from(schema.promotions).orderBy(desc(schema.promotions.createdAt)),
    db.select().from(schema.banners).where(eq(schema.banners.isActive, true)).orderBy(asc(schema.banners.sortOrder)),
    db.select({ id: schema.products.id, name: schema.products.name }).from(schema.products).where(sql`${schema.products.status} <> 'ARCHIVED'`).orderBy(asc(schema.products.name)),
    db.select({ id: schema.categories.id, name: schema.categories.name }).from(schema.categories),
    db.execute<{ n: number }>(sql`select count(*)::int as n from newsletter_subscribers where unsubscribed_at is null`),
  ]);
  const describe = (p: typeof schema.promotions.$inferSelect) =>
    `${p.type === "PERCENT" ? `${p.value}% off` : p.type === "FIXED" ? `${formatKES(p.value)} off` : "Free delivery"}${p.scope === "PRODUCTS" ? ` ${p.productIds.length} product(s)` : p.scope === "CATEGORIES" ? ` ${p.categoryIds.length} categor(ies)` : ""}${p.minOrderCents ? ` · min ${formatKES(p.minOrderCents)}` : ""}`;
  return (
    <>
      <PageHeader title="Promotions" description="Discount codes, automatic offers and home page banners. Discounts are checked on the server at checkout and at the till, so customers can't change them." actions={<Link className="btn-secondary" href="/admin/promotions/newsletter">Newsletter ({subs.rows[0].n})</Link>} />
      <div className="card mb-8 overflow-x-auto">
        <table className="table">
          <thead><tr><th>Promotion</th><th>Code</th><th>Offer</th><th>Dates</th><th className="text-right">Used</th><th className="text-right">Discount given</th><th /></tr></thead>
          <tbody>
            {promos.map(({ p, revenue }) => (
              <tr key={p.id}>
                <td>{p.name} {p.stackable ? <Badge>Combines</Badge> : null} {p.isDemo ? <Badge>Sample</Badge> : null}</td>
                <td>{p.code ?? <span className="text-ink-soft">Automatic</span>}</td>
                <td className="text-[13px]">{describe(p)}</td>
                <td className="text-[13px]">{p.startsAt ? fmtDate(p.startsAt) : "Now"} – {p.endsAt ? fmtDate(p.endsAt) : "no end"}</td>
                <td className="text-right tabular-nums">{p.usageCount}{p.usageLimit ? ` / ${p.usageLimit}` : ""}</td>
                <td className="text-right tabular-nums">{formatKES(revenue)}</td>
                <td><ActionForm action={promotionAction}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="op" value="toggle" /><SubmitButton className="btn-ghost btn-sm">{p.isActive ? "Pause" : "Switch on"}</SubmitButton></ActionForm></td>
              </tr>
            ))}
            {promos.length === 0 ? <tr><td colSpan={7} className="text-ink-soft">No promotions yet.</td></tr> : null}
          </tbody>
        </table>
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <ActionForm action={promotionAction} className="card grid gap-3 p-5 sm:grid-cols-2" resetOnSuccess>
          <h2 className="text-lg sm:col-span-2">New promotion</h2>
          <input className="input sm:col-span-2" name="name" placeholder="Name, e.g. Eid offer 10%" required aria-label="Name" />
          <select className="input" name="type" defaultValue="PERCENT" aria-label="Type"><option value="PERCENT">Percentage off</option><option value="FIXED">Amount off (KES)</option><option value="FREE_DELIVERY">Free delivery</option></select>
          <input className="input" name="value" placeholder="10 (percent) or 200 (KES)" aria-label="Value" />
          <input className="input uppercase" name="code" placeholder="Code (leave empty for automatic)" aria-label="Code" />
          <input className="input" name="minOrder" placeholder="Minimum order (KES, optional)" aria-label="Minimum order" />
          <select className="input" name="scope" defaultValue="ORDER" aria-label="Applies to"><option value="ORDER">Whole order</option><option value="PRODUCTS">Selected products</option><option value="CATEGORIES">Selected categories</option></select>
          <span />
          <select className="input min-h-[100px]" name="productIds" multiple aria-label="Products">{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <select className="input min-h-[100px]" name="categoryIds" multiple aria-label="Categories">{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <label className="text-sm">Starts<input className="input" type="date" name="startsAt" /></label>
          <label className="text-sm">Ends (inclusive)<input className="input" type="date" name="endsAt" /></label>
          <input className="input" name="usageLimit" type="number" min={1} placeholder="Total uses allowed" aria-label="Usage limit" />
          <input className="input" name="perCustomerLimit" type="number" min={1} placeholder="Uses per customer" aria-label="Per customer limit" />
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" className="checkbox" name="stackable" /> Can combine with other combinable offers (otherwise the best single offer applies)</label>
          <div className="sm:col-span-2"><SubmitButton>Create promotion</SubmitButton></div>
        </ActionForm>
        <div className="space-y-4">
          <ActionForm action={bannerAction} className="card space-y-3 p-5" resetOnSuccess>
            <h2 className="text-lg">Home page banner</h2>
            <input className="input" name="title" placeholder="Title" required aria-label="Title" />
            <input className="input" name="body" placeholder="One line of detail" aria-label="Detail" />
            <div className="grid gap-2 sm:grid-cols-2">
              <input className="input" name="linkUrl" placeholder="Link, e.g. /shop?category=oils" aria-label="Link" />
              <input className="input" name="linkLabel" placeholder="Button text" aria-label="Button text" />
              <label className="text-sm">Show from<input className="input" type="date" name="startsAt" /></label>
              <label className="text-sm">Until<input className="input" type="date" name="endsAt" /></label>
            </div>
            <p className="text-[13px] text-ink-soft">Don&apos;t use countdowns or “only a few left” unless it&apos;s true.</p>
            <SubmitButton>Add banner</SubmitButton>
          </ActionForm>
          {banners.map((b) => (
            <div key={b.id} className="card flex items-center justify-between gap-3 p-4">
              <div><p className="font-semibold">{b.title}</p><p className="text-sm text-ink-soft">{b.body} {b.endsAt ? `· until ${fmtDate(b.endsAt)}` : ""}</p></div>
              <ActionForm action={bannerAction}><input type="hidden" name="id" value={b.id} /><input type="hidden" name="op" value="delete" /><SubmitButton className="btn-ghost btn-sm">Hide</SubmitButton></ActionForm>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
