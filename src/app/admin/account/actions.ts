"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { action, str, UserError } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { destroyAllSessions, hashPassword, validatePasswordStrength, verifyPassword } from "@/lib/auth/core";
import { clientIp, requireUser } from "@/lib/auth/server";
import { decryptSecret, encryptSecret, generateTotpSecret, verifyTotp } from "@/lib/crypto";

export const changePasswordAction = action(async (fd) => {
  const u = await requireUser();
  const user = await db.query.users.findFirst({ where: eq(schema.users.id, u.id) });
  if (!user || !(await verifyPassword(String(fd.get("current") ?? ""), user.passwordHash))) throw new UserError("Your current password isn't right.", { current: "Incorrect." });
  const next = String(fd.get("password") ?? "");
  const err = validatePasswordStrength(next);
  if (err) throw new UserError(err, { password: err });
  await db.update(schema.users).set({ passwordHash: await hashPassword(next), passwordChangedAt: new Date() }).where(eq(schema.users.id, u.id));
  await destroyAllSessions(u.id, u.sessionId);
  await audit({ userId: u.id, action: "auth.password_change", entityType: "user", entityId: u.id, ip: await clientIp() });
  return { ok: true, message: "Password changed. Other devices have been signed out." };
});

export const startMfaAction = action(async () => {
  const u = await requireUser();
  const secret = generateTotpSecret();
  await db.update(schema.users).set({ mfaSecretEnc: encryptSecret(secret), mfaEnabled: false }).where(eq(schema.users.id, u.id));
  revalidatePath("/admin/account");
  return { ok: true, message: "Scan the code below, then enter a code from the app to finish." };
});

export const confirmMfaAction = action(async (fd) => {
  const u = await requireUser();
  const user = await db.query.users.findFirst({ where: eq(schema.users.id, u.id) });
  if (!user?.mfaSecretEnc) throw new UserError("Start setup first.");
  if (!verifyTotp(decryptSecret(user.mfaSecretEnc), str(fd, "code"))) throw new UserError("That code didn't match. Check your phone's time is set automatically and try the newest code.");
  await db.update(schema.users).set({ mfaEnabled: true }).where(eq(schema.users.id, u.id));
  await audit({ userId: u.id, action: "auth.mfa_enabled", entityType: "user", entityId: u.id, ip: await clientIp() });
  revalidatePath("/admin/account");
  return { ok: true, message: "Two-step sign-in is on." };
});

export const disableMfaAction = action(async (fd) => {
  const u = await requireUser();
  const user = await db.query.users.findFirst({ where: eq(schema.users.id, u.id) });
  if (!user || !(await verifyPassword(String(fd.get("current") ?? ""), user.passwordHash))) throw new UserError("Enter your password to turn this off.");
  await db.update(schema.users).set({ mfaEnabled: false, mfaSecretEnc: null }).where(eq(schema.users.id, u.id));
  await audit({ userId: u.id, action: "auth.mfa_disabled", entityType: "user", entityId: u.id, ip: await clientIp() });
  revalidatePath("/admin/account");
  return { ok: true, message: "Two-step sign-in is off." };
});
