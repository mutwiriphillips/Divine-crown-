import { ActionForm, SubmitButton } from "@/components/forms";
import { forgotPasswordAction } from "../actions";

export const metadata = { title: "Reset password" };

export default function ForgotPage() {
  return (
    <div className="card p-6">
      <h1 className="mb-1 text-2xl">Reset your password</h1>
      <p className="mb-5 text-ink-soft">We&apos;ll send a reset link to the email or phone on your account.</p>
      <ActionForm action={forgotPasswordAction} className="space-y-4">
        <div>
          <label className="field-label" htmlFor="identifier">Email or phone</label>
          <input className="input" id="identifier" name="identifier" required />
        </div>
        <SubmitButton className="btn-primary w-full">Send reset link</SubmitButton>
      </ActionForm>
    </div>
  );
}
