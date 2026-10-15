import { db, schema } from "@/db";
import { requireStaffPage } from "@/lib/auth/server";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, PageHeader } from "@/components/ui";
import { locationAction } from "../actions";

export const metadata = { title: "Locations" };

export default async function LocationsPage() {
  await requireStaffPage("settings.business", "/admin/inventory/locations");
  const locs = await db.select().from(schema.locations);
  return (
    <>
      <PageHeader title="Stock locations" description="Shops and store rooms that hold stock. Online orders take stock from the default location." />
      <div className="grid gap-4 lg:grid-cols-2">
        {[...locs, null].map((l, i) => (
          <ActionForm key={l?.id ?? `new${i}`} action={locationAction} className="card grid gap-3 p-5 sm:grid-cols-2">
            <h2 className="text-lg sm:col-span-2">{l ? <>{l.name} {l.isDefault ? <Badge tone="ok">Default</Badge> : null}</> : "Add a location"}</h2>
            {l ? <input type="hidden" name="id" value={l.id} /> : null}
            <input className="input" name="name" defaultValue={l?.name ?? ""} placeholder="Name" aria-label="Name" required />
            <input className="input" name="code" defaultValue={l?.code ?? ""} placeholder="Short code, e.g. MAIN" aria-label="Code" required />
            <select className="input" name="type" defaultValue={l?.type ?? "STORE"} aria-label="Type"><option value="STORE">Shop</option><option value="WAREHOUSE">Store room / warehouse</option></select>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="checkbox" name="isDefault" defaultChecked={l?.isDefault} /> Default for online orders</label>
            <div className="sm:col-span-2"><SubmitButton className="btn-primary btn-sm">{l ? "Save" : "Add location"}</SubmitButton></div>
          </ActionForm>
        ))}
      </div>
    </>
  );
}
