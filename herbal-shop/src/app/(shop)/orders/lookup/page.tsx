import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { guestOrderLookupAction } from "../../actions";

export const metadata = { title: "Track an order" };

export default async function LookupPage({ searchParams }: { searchParams: Promise<{ n?: string }> }) {
  const sp = await searchParams;
  return (
    <div className="mx-auto max-w-lg px-4 py-12">
      <h1 className="text-4xl">Track an order</h1>
      <p className="mt-2 text-ink-soft">
        Enter your order number and the phone number used at checkout. We&apos;ll send a private link to the phone and email on the order.
        Have an account? <Link className="link" href="/account">See your orders</Link>.
      </p>
      <ActionForm action={guestOrderLookupAction} className="card mt-6 space-y-4 p-5">
        <div>
          <label className="field-label" htmlFor="number">Order number</label>
          <input className="input uppercase" id="number" name="number" defaultValue={sp.n ?? ""} placeholder="ORD-000123" required />
        </div>
        <div>
          <label className="field-label" htmlFor="phone">Phone number</label>
          <input className="input" id="phone" name="phone" type="tel" placeholder="0712 345 678" required />
        </div>
        <SubmitButton>Send me the link</SubmitButton>
      </ActionForm>
    </div>
  );
}
