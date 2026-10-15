import { redirect } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/forms";
import { getPendingMfaUser } from "@/lib/auth/server";
import { logoutAction, mfaAction } from "../../actions";

export const metadata = { title: "Two-step sign-in" };

export default async function MfaPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const u = await getPendingMfaUser();
  if (!u) redirect("/login");
  const sp = await searchParams;
  return (
    <div className="card p-6">
      <h1 className="mb-1 text-2xl">Enter your code</h1>
      <p className="mb-5 text-ink-soft">Open your authenticator app and enter the 6-digit code for this shop.</p>
      <ActionForm action={mfaAction} className="space-y-4">
        <input type="hidden" name="next" value={sp.next ?? ""} />
        <input className="input text-center text-2xl tracking-[0.4em]" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required autoFocus aria-label="6-digit code" />
        <SubmitButton className="btn-primary w-full">Verify</SubmitButton>
      </ActionForm>
      <form action={logoutAction} className="mt-4 text-center">
        <button className="link text-sm">Cancel and sign out</button>
      </form>
    </div>
  );
}
