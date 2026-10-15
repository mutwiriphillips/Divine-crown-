import { requireStaffPage } from "@/lib/auth/server";
import { getSetting } from "@/lib/settings";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, Notice, PageHeader } from "@/components/ui";
import { saveCommerceAction } from "../actions";

export const metadata = { title: "Tax, checkout & receipts" };

function Toggle({ name, label, hint, on }: { name: string; label: string; hint?: string; on: boolean }) {
  return (
    <label className="flex items-start gap-3">
      <input type="checkbox" className="checkbox mt-0.5" name={name} defaultChecked={on} />
      <span><span className="font-semibold">{label}</span>{hint ? <span className="block text-sm text-ink-soft">{hint}</span> : null}</span>
    </label>
  );
}

export default async function CommerceSettings() {
  await requireStaffPage("settings.financial", "/admin/settings/commerce");
  const c = await getSetting("commerce");
  return (
    <>
      <PageHeader title="Tax, checkout & receipts" description="Changes are recorded in the audit log with before and after values." />
      <ActionForm action={saveCommerceAction} className="space-y-6">
        <section className="card space-y-4 p-5">
          <h2 className="text-lg">VAT</h2>
          <Notice tone="plum">Confirm your VAT and electronic invoicing (eTIMS) obligations with KRA or your accountant. This system calculates VAT as configured but does not send invoices to KRA.</Notice>
          <Toggle name="vatRegistered" label="We are registered for VAT" hint="When off, no VAT is calculated or shown." on={c.vatRegistered} />
          <Field label="VAT rate (%)" name="vatRate"><input className="input w-32" id="vatRate" name="vatRate" inputMode="decimal" defaultValue={c.vatRateBp / 100} /></Field>
          <Toggle name="pricesIncludeTax" label="Prices include VAT" hint="Recommended for retail: the price on the shelf is what the customer pays." on={c.pricesIncludeTax} />
          <Toggle name="etimsConnected" label="Our sales are reported to KRA eTIMS through another approved system" hint="Only then are documents titled “Tax invoice”. Otherwise they are payment receipts." on={c.etimsConnected} />
          <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="checkbox mt-0.5" name="etimsConfirm" /> I confirm the statement above is true (required to turn on tax invoices).</label>
        </section>
        <section className="card space-y-4 p-5">
          <h2 className="text-lg">Checkout</h2>
          <Toggle name="guestCheckout" label="Allow checkout without an account" on={c.guestCheckout} />
          <Toggle name="collectionEnabled" label="Offer collection from the shop" on={c.collectionEnabled} />
          <Field label="Collection address shown at checkout" name="collectionAddress"><input className="input" id="collectionAddress" name="collectionAddress" defaultValue={c.collectionAddress} /></Field>
          <Toggle name="cashOnDelivery" label="Offer pay on delivery / collection" hint="Orders go straight to processing with stock held; record the payment when you receive it." on={c.cashOnDelivery} />
          <Field label="Hold stock for unpaid M-Pesa orders for (minutes)" name="reservationMinutes" hint="After this, unpaid orders are cancelled and the stock released."><input className="input w-32" id="reservationMinutes" name="reservationMinutes" type="number" min={5} max={1440} defaultValue={c.reservationMinutes} /></Field>
          <Toggle name="wholesaleEnabled" label="Wholesale prices" hint="Customers marked as wholesale see wholesale prices when they buy at least the minimum quantity." on={c.wholesaleEnabled} />
          <Toggle name="abandonedCartReminders" label="Cart reminders" hint="One email to signed-in customers who opted in to marketing, a few hours after they leave items in their cart." on={c.abandonedCartReminders} />
        </section>
        <section className="card space-y-4 p-5">
          <h2 className="text-lg">Receipts and till</h2>
          <Field label="Receipt footer" name="receiptFooter"><input className="input" id="receiptFooter" name="receiptFooter" defaultValue={c.receiptFooter} /></Field>
          <Field label="Returns note on receipts" name="returnPolicySummary"><input className="input" id="returnPolicySummary" name="returnPolicySummary" defaultValue={c.returnPolicySummary} placeholder="e.g. Unopened items can be returned within 7 days with this receipt." /></Field>
          <Toggle name="posAllowManualMpesaCode" label="Cashiers may enter an M-Pesa code for till payments" hint="The code must be checked against the till's M-Pesa message. Each code can be used only once." on={c.posAllowManualMpesaCode} />
        </section>
        <section className="card space-y-4 p-5">
          <h2 className="text-lg">Alerts and security</h2>
          <Field label="Email for low-stock alerts" name="lowStockEmail"><input className="input" id="lowStockEmail" name="lowStockEmail" type="email" defaultValue={c.lowStockEmail} /></Field>
          <Field label="Email for the daily sales summary" name="dailySummaryEmail"><input className="input" id="dailySummaryEmail" name="dailySummaryEmail" type="email" defaultValue={c.dailySummaryEmail} /></Field>
          <Toggle name="requireMfaForOwner" label="Remind owners to use two-step sign-in" on={c.requireMfaForOwner} />
        </section>
        <SubmitButton>Save settings</SubmitButton>
      </ActionForm>
    </>
  );
}
