import { asc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireStaffPage } from "@/lib/auth/server";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, PageHeader } from "@/components/ui";
import { adjustStockAction, transferAction } from "../actions";

export const metadata = { title: "Adjust stock" };

export default async function AdjustPage({ searchParams }: { searchParams: Promise<{ variant?: string }> }) {
  await requireStaffPage("inventory.adjust", "/admin/inventory/adjust");
  const sp = await searchParams;
  const [variants, locations] = await Promise.all([
    db
      .select({ id: schema.productVariants.id, name: schema.productVariants.name, product: schema.products.name, sku: schema.productVariants.sku })
      .from(schema.productVariants)
      .innerJoin(schema.products, eq(schema.products.id, schema.productVariants.productId))
      .where(sql`not ${schema.productVariants.isBundle} and ${schema.products.status} <> 'ARCHIVED'`)
      .orderBy(asc(schema.products.name)),
    db.select().from(schema.locations).where(eq(schema.locations.isActive, true)),
  ]);
  const def = locations.find((l) => l.isDefault) ?? locations[0];
  const VariantSelect = ({ name = "variantId" }: { name?: string }) => (
    <select className="input" name={name} defaultValue={sp.variant ?? ""} required>
      <option value="">Choose a product…</option>
      {variants.map((v) => <option key={v.id} value={v.id}>{v.product} · {v.name}{v.sku ? ` (${v.sku})` : ""}</option>)}
    </select>
  );
  return (
    <>
      <PageHeader title="Adjust stock" description="Every change is recorded with your name, the reason and the time. To receive a supplier delivery, use Purchase orders instead so costs are tracked." />
      <div className="grid gap-6 lg:grid-cols-2">
        <ActionForm action={adjustStockAction} className="card space-y-4 p-5">
          <h2 className="text-lg">Change stock</h2>
          <Field label="Product"><VariantSelect /></Field>
          <Field label="Location">
            <select className="input" name="locationId" defaultValue={def?.id}>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
          </Field>
          <Field label="What happened?">
            <select className="input" name="kind" defaultValue="COUNT_CORRECTION">
              <option value="COUNT_CORRECTION">I counted the shelf (enter the count)</option>
              <option value="INITIAL">Opening stock (first time recording it)</option>
              <option value="DAMAGE">Damaged — remove from sale</option>
              <option value="EXPIRY">Expired — remove from sale</option>
              <option value="WRITE_OFF_QUARANTINE">Throw away damaged/expired units</option>
              <option value="RELEASE_QUARANTINE">Damaged units turned out fine — back to sale</option>
              <option value="SUPPLIER_RETURN">Returned to supplier</option>
            </select>
          </Field>
          <Field label="Quantity" hint="For a count, enter how many you counted. Otherwise enter how many units this affects.">
            <input className="input" name="qty" type="number" min={0} required />
          </Field>
          <Field label="Reason" hint="Required. e.g. 'Monthly count', 'Bottle broke on shelf'.">
            <input className="input" name="reason" required minLength={3} />
          </Field>
          <details className="text-sm">
            <summary className="cursor-pointer text-plum">Opening stock: cost and batch (optional)</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <input className="input input-sm" name="unitCost" placeholder="Cost per unit (KES)" inputMode="decimal" aria-label="Unit cost" />
              <input className="input input-sm" name="batchNo" placeholder="Batch no." aria-label="Batch number" />
              <input className="input input-sm" name="expiresAt" type="date" aria-label="Expiry date" />
            </div>
          </details>
          <SubmitButton>Save change</SubmitButton>
        </ActionForm>
        {locations.length > 1 ? (
          <ActionForm action={transferAction} className="card space-y-4 p-5">
            <h2 className="text-lg">Move stock between locations</h2>
            <Field label="Product"><VariantSelect /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="From"><select className="input" name="fromLocationId">{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
              <Field label="To"><select className="input" name="toLocationId" defaultValue={locations[1]?.id}>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
            </div>
            <Field label="Quantity"><input className="input" name="qty" type="number" min={1} required /></Field>
            <Field label="Note"><input className="input" name="reason" placeholder="Stock transfer" /></Field>
            <SubmitButton>Move stock</SubmitButton>
          </ActionForm>
        ) : (
          <div className="card p-5 text-sm text-ink-soft">
            <h2 className="mb-2 text-lg text-plum">One location</h2>
            Stock transfers appear here once you add a second shop or store room under <a className="link" href="/admin/inventory/locations">Locations</a>.
          </div>
        )}
      </div>
    </>
  );
}
