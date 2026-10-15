import Link from "next/link";
import { ActionForm, FieldError, SubmitButton } from "@/components/forms";
import { registerAction } from "../actions";

export const metadata = { title: "Create an account" };

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const sp = await searchParams;
  return (
    <div className="card p-6">
      <h1 className="mb-1 text-2xl">Create an account</h1>
      <p className="mb-5 text-ink-soft">Track orders, save addresses and download receipts.</p>
      <ActionForm action={registerAction} className="space-y-4">
        <input type="hidden" name="next" value={sp.next ?? ""} />
        <div>
          <label className="field-label" htmlFor="name">Full name</label>
          <input className="input" id="name" name="name" autoComplete="name" required />
          <FieldError name="name" />
        </div>
        <div>
          <label className="field-label" htmlFor="phone">Phone</label>
          <input className="input" id="phone" name="phone" type="tel" autoComplete="tel" placeholder="0712 345 678" />
          <FieldError name="phone" />
        </div>
        <div>
          <label className="field-label" htmlFor="email">Email <span className="font-normal text-ink-soft">(optional if you give a phone)</span></label>
          <input className="input" id="email" name="email" type="email" autoComplete="email" />
          <FieldError name="email" />
        </div>
        <div>
          <label className="field-label" htmlFor="password">Password</label>
          <input className="input" id="password" name="password" type="password" autoComplete="new-password" minLength={10} required />
          <p className="field-hint">At least 10 characters.</p>
          <FieldError name="password" />
        </div>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" name="consent" className="checkbox mt-0.5" required />
          <span>I agree to the <Link className="link" href="/policies/privacy">privacy notice</Link>, which explains how my details are used.</span>
        </label>
        <FieldError name="consent" />
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" name="marketing" className="checkbox mt-0.5" />
          <span>Email me about new products and offers. I can stop this any time.</span>
        </label>
        <SubmitButton className="btn-primary w-full" pendingText="Creating account…">Create account</SubmitButton>
      </ActionForm>
      <p className="mt-5 text-center text-sm">Already have an account? <Link className="link" href="/login">Sign in</Link></p>
    </div>
  );
}
