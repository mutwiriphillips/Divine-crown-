import QRCode from "qrcode";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireStaffPage } from "@/lib/auth/server";
import { decryptSecret } from "@/lib/crypto";
import { getSetting } from "@/lib/settings";
import { ActionForm, FieldError, SubmitButton } from "@/components/forms";
import { Notice, PageHeader } from "@/components/ui";
import { logoutAction } from "@/app/(auth)/actions";
import { changePasswordAction, confirmMfaAction, disableMfaAction, startMfaAction } from "./actions";

export const metadata = { title: "My account" };

export default async function AccountSecurityPage() {
  const u = await requireStaffPage(undefined, "/admin/account");
  const user = await db.query.users.findFirst({ where: eq(schema.users.id, u.id) });
  const business = await getSetting("business");
  let qr: string | null = null;
  let secret: string | null = null;
  if (user?.mfaSecretEnc && !user.mfaEnabled) {
    secret = decryptSecret(user.mfaSecretEnc);
    const label = encodeURIComponent(`${business.name}:${user.email ?? user.phone}`);
    qr = await QRCode.toString(`otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(business.name)}`, { type: "svg", margin: 1, width: 180 });
  }
  return (
    <>
      <PageHeader title="My account & security" description={`${u.name} · ${u.roleName}`} actions={<form action={logoutAction}><button className="btn-secondary">Sign out</button></form>} />
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="mb-3 text-lg">Change password</h2>
          <ActionForm action={changePasswordAction} className="space-y-3" resetOnSuccess>
            <div>
              <label className="field-label" htmlFor="current">Current password</label>
              <input className="input" id="current" name="current" type="password" autoComplete="current-password" required />
              <FieldError name="current" />
            </div>
            <div>
              <label className="field-label" htmlFor="password">New password</label>
              <input className="input" id="password" name="password" type="password" autoComplete="new-password" minLength={10} required />
              <FieldError name="password" />
            </div>
            <SubmitButton>Change password</SubmitButton>
          </ActionForm>
        </section>
        <section className="card p-5">
          <h2 className="mb-1 text-lg">Two-step sign-in</h2>
          <p className="mb-3 text-sm text-ink-soft">Ask for a code from an authenticator app (Google Authenticator, Microsoft Authenticator, Authy) when signing in. Recommended for owners and managers.</p>
          {user?.mfaEnabled ? (
            <>
              <Notice tone="ok">On. You&apos;ll be asked for a code each time you sign in.</Notice>
              <ActionForm action={disableMfaAction} className="mt-4 space-y-2">
                <label className="field-label" htmlFor="mfa-current">Password (to turn off)</label>
                <input className="input" id="mfa-current" name="current" type="password" required />
                <SubmitButton className="btn-secondary">Turn off</SubmitButton>
              </ActionForm>
            </>
          ) : qr ? (
            <div className="space-y-3">
              <div className="inline-block rounded bg-white p-2" dangerouslySetInnerHTML={{ __html: qr }} />
              <p className="text-sm">Can&apos;t scan? Enter this key: <code className="break-all">{secret}</code></p>
              <ActionForm action={confirmMfaAction} className="flex gap-2">
                <input className="input w-40 text-center tracking-[0.3em]" name="code" inputMode="numeric" maxLength={7} placeholder="123456" required aria-label="Code from app" />
                <SubmitButton>Confirm</SubmitButton>
              </ActionForm>
            </div>
          ) : (
            <ActionForm action={startMfaAction}>
              <SubmitButton>Set up two-step sign-in</SubmitButton>
            </ActionForm>
          )}
        </section>
      </div>
    </>
  );
}
