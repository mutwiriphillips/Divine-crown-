import { and, desc, eq, gte, lt, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireStaffPage } from "@/lib/auth/server";
import { dateRange } from "@/lib/order-query";
import { fmtDate, Money, PageHeader, Pagination } from "@/components/ui";

export const metadata = { title: "Stock movements" };

const LABEL: Record<string, string> = {
  INITIAL: "Opening stock", PURCHASE_RECEIVED: "Received", SALE: "Sold", CUSTOMER_RETURN: "Customer return", SUPPLIER_RETURN: "Returned to supplier",
  DAMAGE: "Damaged", EXPIRY: "Expired", ADJUSTMENT: "Adjustment", TRANSFER_OUT: "Transfer out", TRANSFER_IN: "Transfer in",
  RESERVATION: "Held for order", RESERVATION_RELEASE: "Hold released", QUARANTINE_IN: "Returned damaged", QUARANTINE_WRITE_OFF: "Written off",
};

export default async function MovementsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireStaffPage("inventory.view", "/admin/inventory/movements");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const m = schema.stockMovements;
  const conds: SQL[] = [];
  if (sp.variant && /^[0-9a-f-]{36}$/.test(sp.variant)) conds.push(eq(m.variantId, sp.variant));
  if (sp.type) conds.push(eq(m.type, sp.type as "SALE"));
  if (sp.holds !== "1") conds.push(sql`${m.type} not in ('RESERVATION','RESERVATION_RELEASE')`);
  const r = dateRange(sp.from, sp.to);
  if (r.from) conds.push(gte(m.createdAt, r.from));
  if (r.to) conds.push(lt(m.createdAt, r.to));
  const where = conds.length ? and(...conds) : undefined;
  const [rows, count] = await Promise.all([
    db
      .select({ m, product: schema.products.name, variant: schema.productVariants.name, loc: schema.locations.name, user: schema.users.name })
      .from(m)
      .innerJoin(schema.productVariants, eq(schema.productVariants.id, m.variantId))
      .innerJoin(schema.products, eq(schema.products.id, schema.productVariants.productId))
      .innerJoin(schema.locations, eq(schema.locations.id, m.locationId))
      .leftJoin(schema.users, eq(schema.users.id, m.userId))
      .where(where)
      .orderBy(desc(m.createdAt))
      .limit(50)
      .offset((page - 1) * 50),
    db.select({ n: sql<number>`count(*)::int` }).from(m).where(where),
  ]);
  const qs = (p: number) => `?${new URLSearchParams(Object.entries({ ...sp, page: String(p) }).filter(([, v]) => v) as [string, string][])}`;
  return (
    <>
      <PageHeader title="Stock movements" description="Every change to stock, newest first. This record can't be edited; mistakes are corrected with a new adjustment." />
      <form className="mb-4 flex flex-wrap gap-2">
        {sp.variant ? <input type="hidden" name="variant" value={sp.variant} /> : null}
        <select className="input input-sm w-auto" name="type" defaultValue={sp.type ?? ""} aria-label="Type">
          <option value="">All types</option>
          {Object.entries(LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input className="input input-sm w-auto" type="date" name="from" defaultValue={sp.from} aria-label="From" />
        <input className="input input-sm w-auto" type="date" name="to" defaultValue={sp.to} aria-label="To" />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="checkbox" name="holds" value="1" defaultChecked={sp.holds === "1"} /> Include order holds</label>
        <button className="btn-secondary btn-sm">Filter</button>
      </form>
      <div className="card overflow-x-auto">
        <table className="table">
          <thead><tr><th>When</th><th>Product</th><th>What</th><th className="text-right">Change</th><th className="text-right">On hand after</th><th>Reason</th><th>By</th></tr></thead>
          <tbody>
            {rows.map(({ m: x, product, variant, loc, user }) => (
              <tr key={x.id}>
                <td className="whitespace-nowrap">{fmtDate(x.createdAt, true)}</td>
                <td>{product}<span className="block text-[12px] text-ink-soft">{variant} · {loc}{x.batchNo ? ` · batch ${x.batchNo}` : ""}</span></td>
                <td>{LABEL[x.type]}</td>
                <td className={`text-right tabular-nums ${x.onHandDelta < 0 ? "text-bad" : x.onHandDelta > 0 ? "text-ok" : "text-ink-soft"}`}>
                  {x.onHandDelta ? (x.onHandDelta > 0 ? `+${x.onHandDelta}` : x.onHandDelta) : x.reservedDelta ? `held ${x.reservedDelta > 0 ? "+" : ""}${x.reservedDelta}` : `damaged ${x.quarantineDelta > 0 ? "+" : ""}${x.quarantineDelta}`}
                </td>
                <td className="text-right tabular-nums">{x.onHandAfter}</td>
                <td>{x.reason}{x.unitCostCents != null && x.type === "PURCHASE_RECEIVED" ? <span className="block text-[12px] text-ink-soft">@ <Money cents={x.unitCostCents} /></span> : null}</td>
                <td>{user ?? (x.userId ? "Staff" : "System/online")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pageSize={50} total={count[0].n} hrefFor={qs} />
    </>
  );
}
