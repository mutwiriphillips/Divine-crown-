import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireStaffPage } from "@/lib/auth/server";
import { ActionForm, IdempotencyKey, SubmitButton } from "@/components/forms";
import { Field, PageHeader } from "@/components/ui";
import { stockVariants } from "@/components/variant-options";
import { receiveAction } from "../actions";

export const metadata = { title: "Receive goods" };

export default async function ReceivePage() {
  await requireStaffPage("purchasing.receive", "/admin/purchasing/receive");
  const [suppliers, locations, variants] = await Promise.all([
    db.select().from(schema.suppliers).where(eq(schema.suppliers.isActive, true)).orderBy(asc(schema.suppliers.name)),
    db.select().from(schema.locations).where(eq(schema.locations.isActive, true)),
    stockVariants(),
  ]);
  return (
    <>
      <PageHeader title="Receive goods without an order" description="For deliveries that weren't raised as a purchase order. Costs keep average cost and gross profit accurate." />
      <ActionForm action={receiveAction} className="card space-y-5 p-5">
        <IdempotencyKey />
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Supplier"><select className="input" name="supplierId" required><option value="">Choose…</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          <Field label="Into"><select className="input" name="locationId" defaultValue={locations.find((l) => l.isDefault)?.id}>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
          <Field label="Supplier invoice no."><input className="input" name="supplierInvoiceRef" /></Field>
        </div>
        <table className="table">
          <thead><tr><th>Product</th><th className="w-24">Qty</th><th className="w-32">Cost/unit (KES)</th><th className="w-32">Batch</th><th className="w-40">Expiry</th></tr></thead>
          <tbody>
            {Array.from({ length: 8 }, (_, i) => (
              <tr key={i}>
                <td><input type="hidden" name="poItemId" value="" /><select className="input input-sm" name="variantId" defaultValue="" aria-label={`Product line ${i + 1}`}><option value="">—</option>{variants.map((x) => <option key={x.id} value={x.id}>{x.product} · {x.name}</option>)}</select></td>
                <td><input className="input input-sm" name="qty" type="number" min={0} aria-label="Quantity" /></td>
                <td><input className="input input-sm" name="unitCost" inputMode="decimal" aria-label="Unit cost" /></td>
                <td><input className="input input-sm" name="batchNo" aria-label="Batch" /></td>
                <td><input className="input input-sm" name="expiresAt" type="date" aria-label="Expiry" /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <Field label="Notes"><input className="input" name="notes" /></Field>
        <SubmitButton pendingText="Receiving…">Receive into stock</SubmitButton>
      </ActionForm>
    </>
  );
}
