import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCustomerPage } from "@/lib/auth/server";
import { currentCustomerId } from "@/lib/cart";
import { ActionForm, FieldError, SubmitButton } from "@/components/forms";
import { customerPasswordAction, deletionRequestAction, updatePreferencesAction, updateProfileAction } from "../actions";

export const metadata = { title: "Details & privacy" };

export default async function ProfilePage() {
  const u = await requireCustomerPage("/account/profile");
  const cid = await currentCustomerId();
  const c = cid ? await db.query.customers.findFirst({ where: eq(schema.customers.id, cid) }) : null;
  return (
    <div className="space-y-8">
      <section className="card p-5">
        <h2 className="mb-4 text-2xl">Your details</h2>
        <ActionForm action={updateProfileAction} className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="field-label" htmlFor="name">Name</label>
            <input className="input" id="name" name="name" defaultValue={u.name} required />
            <FieldError name="name" />
          </div>
          <div>
            <label className="field-label" htmlFor="phone">Phone</label>
            <input className="input" id="phone" name="phone" defaultValue={u.phone?.replace(/^254/, "0") ?? ""} />
            <FieldError name="phone" />
          </div>
          <div>
            <label className="field-label" htmlFor="email">Email</label>
            <input className="input" id="email" name="email" type="email" defaultValue={u.email ?? ""} />
            <FieldError name="email" />
          </div>
          <div><SubmitButton>Save details</SubmitButton></div>
        </ActionForm>
      </section>
      <section className="card p-5">
        <h2 className="mb-1 text-2xl">Messages from us</h2>
        <p className="mb-4 text-sm text-ink-soft">Order and payment updates are always sent. These choices are only for offers and news.</p>
        <ActionForm action={updatePreferencesAction} className="space-y-2">
          <label className="flex items-center gap-2"><input type="checkbox" className="checkbox" name="marketingEmail" defaultChecked={c?.marketingEmail} /> Offers by email</label>
          <label className="flex items-center gap-2"><input type="checkbox" className="checkbox" name="marketingSms" defaultChecked={c?.marketingSms} /> Offers by SMS</label>
          <label className="flex items-center gap-2"><input type="checkbox" className="checkbox" name="marketingWhatsapp" defaultChecked={c?.marketingWhatsapp} /> Offers on WhatsApp</label>
          <SubmitButton className="btn-secondary">Save preferences</SubmitButton>
        </ActionForm>
      </section>
      <section className="card p-5">
        <h2 className="mb-4 text-2xl">Password</h2>
        <ActionForm action={customerPasswordAction} className="grid max-w-md gap-3" resetOnSuccess>
          <input className="input" name="current" type="password" placeholder="Current password" autoComplete="current-password" required aria-label="Current password" />
          <input className="input" name="password" type="password" placeholder="New password (10+ characters)" autoComplete="new-password" minLength={10} required aria-label="New password" />
          <div><SubmitButton className="btn-secondary">Change password</SubmitButton></div>
        </ActionForm>
      </section>
      <section className="card p-5">
        <h2 className="mb-2 text-2xl">Your data</h2>
        <p className="mb-3 text-sm text-ink-soft">Under the Kenya Data Protection Act you can get a copy of your personal data and ask us to delete it.</p>
        <a className="btn-secondary" href="/account/export">Download my data</a>
        <details className="mt-5">
          <summary className="cursor-pointer font-semibold text-bad">Delete my account</summary>
          <ActionForm action={deletionRequestAction} className="mt-3 max-w-md space-y-3">
            <p className="text-sm text-ink-soft">We&apos;ll remove your personal details. Records of past purchases are kept, without your name or contact details, where tax and accounting rules require it.</p>
            <textarea className="input" name="note" placeholder="Anything you'd like us to know (optional)" aria-label="Note" />
            <input className="input" name="confirm" placeholder="Type DELETE to confirm" aria-label="Type DELETE to confirm" required />
            <SubmitButton className="btn-danger">Request deletion</SubmitButton>
          </ActionForm>
        </details>
      </section>
    </div>
  );
}
