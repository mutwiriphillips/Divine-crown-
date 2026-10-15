import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireStaffPage } from "@/lib/auth/server";
import { ActionForm, SubmitButton } from "@/components/forms";
import { EmptyState, Field, PageHeader } from "@/components/ui";
import { stockVariants } from "@/components/variant-options";
import { createPoAction } from "../actions";

export const metadata = { title: "New purchase order" };

export default async function NewPoPage({ searchParams }: { searchParams: Promise<{ supplier?: string; items?: string }> }) {
  await requireStaffPage("purchasing.manage", "/admin/purchasing/new");
  const sp = await searchParams;
  const [suppliers, locations, variants] = await Promise.all([
    db.select().from(schema.suppliers).where(eq(schema.suppliers.isActive, true)).orderBy(asc(schema.suppliers.name)),
    db.select().from(schema.locations).where(eq(schema.locations.isActive, true)),
    stockVariants(),
  ]);
  if (!suppliers.length) return <EmptyState title="Add a supplier first" action={<Link className="btn-primary" href="/admin/suppliers">Add supplier</Link>}>Purchase orders are raised against a supplier.</EmptyState>;
  const prefill = (sp.items ?? "").split(",").filter(Boolean).map((s) => { const [id, q] = s.split(":"); return { id, qty: Number(q) || 1 }; });
  const rows = [...prefill, ...Array.from({ length: Math.max(3, 8 - prefill.length) }, () => ({ id: "", qty: 0 }))];
  return (
    <>
      <PageHeader title="New purchase order" description="Costs are per unit, in shillings. They're used for gross profit once the goods are received." />
      <ActionForm action={createPoAction} className="card space-y-5 p-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Supplier"><select className="input" name="supplierId" defaultValue={sp.supplier ?? ""} required><option value="">Choose…</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          <Field label="Deliver to"><select className="input" name="locationId" defaultValue={locations.find((l) => l.isDefault)?.id}>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
          <Field label="Expected delivery"><input className="input" type="date" name="expectedAt" /></Field>
        </div>
        <table className="table">
          <thead><tr><th>Product</th><th className="w-28">Quantity</th><th className="w-40">Cost per unit (KES)</th></tr></thead>
          <tbody>
            {rows.map((r, i) => {
              const v = variants.find((x) => x.id === r.id);
              return (
                <tr key={i}>
                  <td><select className="input input-sm" name="variantId" defaultValue={r.id} aria-label={`Product line ${i + 1}`}><option value="">—</option>{variants.map((x) => <option key={x.id} value={x.id}>{x.product} · {x.name}{x.sku ? ` (${x.sku})` : ""}</option>)}</select></td>
                  <td><input className="input input-sm" name="qty" type="number" min={0} defaultValue={r.qty || ""} aria-label="Quantity" /></td>
                  <td><input className="input input-sm" name="unitCost" inputMode="decimal" defaultValue={v?.cost != null ? String(v.cost / 100) : ""} aria-label="Unit cost" /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <Field label="Notes for the supplier"><textarea className="input" name="notes" /></Field>
        <SubmitButton>Save as draft</SubmitButton>
      </ActionForm>
    </>
  );
}
