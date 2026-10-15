import Link from "next/link";
import { ActionForm, FieldError, SubmitButton } from "@/components/forms";
import { Notice } from "@/components/ui";
import { loginAction } from "../actions";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; reset?: string }> }) {
  const sp = await searchParams;
  return (
    <div className="card p-6">
      <h1 className="mb-1 text-2xl">Sign in</h1>
      <p className="mb-5 text-ink-soft">Use the email or phone number on your account.</p>
      {sp.reset ? <div className="mb-4"><Notice tone="ok">Password changed. Sign in with your new password.</Notice></div> : null}
      <ActionForm action={loginAction} className="space-y-4">
        <input type="hidden" name="next" value={sp.next ?? ""} />
        <div>
          <label className="field-label" htmlFor="identifier">Email or phone</label>
          <input className="input" id="identifier" name="identifier" autoComplete="username" required />
          <FieldError name="identifier" />
        </div>
        <div>
          <label className="field-label" htmlFor="password">Password</label>
          <input className="input" id="password" name="password" type="password" autoComplete="current-password" required />
        </div>
        <SubmitButton className="btn-primary w-full" pendingText="Signing in…">Sign in</SubmitButton>
      </ActionForm>
      <div className="mt-5 flex justify-between text-sm">
        <Link className="link" href="/forgot-password">Forgot password?</Link>
        <Link className="link" href={`/register${sp.next ? `?next=${encodeURIComponent(sp.next)}` : ""}`}>Create an account</Link>
      </div>
    </div>
  );
}
