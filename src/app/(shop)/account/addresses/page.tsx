import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { currentCustomerId } from "@/lib/cart";
import { ActionForm, FieldError, SubmitButton } from "@/components/forms";
import { deleteAddressAction, saveAddressAction } from "../actions";

export const metadata = { title: "Addresses" };

function AddressFields({ a }: { a?: typeof schema.addresses.$inferSelect }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <input className="input" name="label" placeholder="Label, e.g. Home" defaultValue={a?.label ?? ""} aria-label="Label" />
      <input className="input" name="recipient" placeholder="Recipient name" defaultValue={a?.recipient ?? ""} required aria-label="Recipient" />
      <div>
        <input className="input" name="phone" placeholder="Phone" defaultValue={a?.phone?.replace(/^254/, "0") ?? ""} required aria-label="Phone" />
        <FieldError name="phone" />
      </div>
      <input className="input" name="county" placeholder="County" defaultValue={a?.county ?? ""} required aria-label="County" />
      <input className="input" name="town" placeholder="Town" defaultValue={a?.town ?? ""} required aria-label="Town" />
      <input className="input" name="area" placeholder="Estate / area" defaultValue={a?.area ?? ""} aria-label="Area" />
      <input className="input" name="street" placeholder="Street / building" defaultValue={a?.street ?? ""} aria-label="Street" />
      <input className="input" name="landmark" placeholder="Landmark" defaultValue={a?.landmark ?? ""} aria-label="Landmark" />
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" className="checkbox" name="isDefault" defaultChecked={a?.isDefault} /> Use at checkout by default
      </label>
    </div>
  );
}

export default async function AddressesPage() {
  const cid = await currentCustomerId();
  const list = cid ? await db.select().from(schema.addresses).where(eq(schema.addresses.customerId, cid)).orderBy(asc(schema.addresses.createdAt)) : [];
  return (
    <div className="space-y-6">
      <h2 className="text-2xl">Delivery addresses</h2>
      {list.map((a) => (
        <details key={a.id} className="card p-4">
          <summary className="cursor-pointer">
            <span className="font-semibold">{a.label ?? a.recipient}</span>
            {a.isDefault ? <span className="ml-2 text-sm text-ok">Default</span> : null}
            <span className="block text-sm text-ink-soft">{[a.street, a.area, a.town, a.county].filter(Boolean).join(", ")}</span>
          </summary>
          <ActionForm action={saveAddressAction} className="mt-4 space-y-3">
            <input type="hidden" name="id" value={a.id} />
            <AddressFields a={a} />
            <SubmitButton className="btn-primary btn-sm">Save</SubmitButton>
          </ActionForm>
          <ActionForm action={deleteAddressAction} confirm="Remove this address?" className="mt-2">
            <input type="hidden" name="id" value={a.id} />
            <SubmitButton className="btn-ghost btn-sm">Remove</SubmitButton>
          </ActionForm>
        </details>
      ))}
      <section className="card p-5">
        <h3 className="mb-3 text-lg">Add an address</h3>
        <ActionForm action={saveAddressAction} className="space-y-3" resetOnSuccess>
          <AddressFields />
          <SubmitButton>Add address</SubmitButton>
        </ActionForm>
      </section>
    </div>
  );
}
