import { ActionForm, FieldError, SubmitButton } from "@/components/forms";
import { resetPasswordAction } from "../actions";

export const metadata = { title: "Choose a new password" };

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  return (
    <div className="card p-6">
      <h1 className="mb-4 text-2xl">Choose a new password</h1>
      <ActionForm action={resetPasswordAction} className="space-y-4">
        <input type="hidden" name="token" value={token} />
        <div>
          <label className="field-label" htmlFor="password">New password</label>
          <input className="input" id="password" name="password" type="password" autoComplete="new-password" minLength={10} required />
          <p className="field-hint">At least 10 characters. You&apos;ll be signed out everywhere else.</p>
          <FieldError name="password" />
        </div>
        <SubmitButton className="btn-primary w-full">Save password</SubmitButton>
      </ActionForm>
    </div>
  );
}
