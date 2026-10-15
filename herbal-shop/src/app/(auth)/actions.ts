"use server";

import { and, eq, gt, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { action, str, UserError } from "@/lib/actions";
import { audit } from "@/lib/audit";
import {
  checkCredentials,
  createSession,
  destroyAllSessions,
  destroySession,
  hashPassword,
  normalizeEmail,
  normalizePhone,
  validatePasswordStrength,
} from "@/lib/auth/core";
import { clearSessionCookie, clientIp, getPendingMfaUser, getSessionToken, setSessionCookie } from "@/lib/auth/server";
import { decryptSecret, randomToken, sha256, verifyTotp } from "@/lib/crypto";
import { notify } from "@/lib/notifications";
import { rateLimit } from "@/lib/ratelimit";
import { headers } from "next/headers";

function safeNext(next: string, fallback: string) {
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : fallback;
}

export const loginAction = action(async (fd) => {
  const identifier = str(fd, "identifier");
  const password = String(fd.get("password") ?? "");
  const ip = await clientIp();
  if (!(await rateLimit(`login:ip:${ip ?? "unknown"}`, 20, 600)) || !(await rateLimit(`login:id:${identifier.toLowerCase()}`, 10, 600))) {
    throw new UserError("Too many sign-in attempts. Wait 10 minutes and try again.");
  }
  const r = await checkCredentials(identifier, password, ip);
  if (!r.ok) throw new UserError(r.error);
  const ua = (await headers()).get("user-agent");
  const { token, expiresAt } = await createSession(r.userId, { isStaff: r.isStaff, mfaPending: r.mfaRequired, ip, userAgent: ua });
  await setSessionCookie(token, expiresAt);
  await audit({ userId: r.userId, action: "auth.login", entityType: "user", entityId: r.userId, ip, details: { mfa: r.mfaRequired } });
  const next = str(fd, "next");
  if (r.mfaRequired) redirect(`/login/mfa?next=${encodeURIComponent(next)}`);
  redirect(safeNext(next, r.isStaff ? "/admin" : "/account"));
});

export const mfaAction = action(async (fd) => {
  const u = await getPendingMfaUser();
  if (!u) redirect("/login");
  const ip = await clientIp();
  if (!(await rateLimit(`mfa:${u.id}`, 8, 600))) throw new UserError("Too many attempts. Wait 10 minutes and sign in again.");
  const user = await db.query.users.findFirst({ where: eq(schema.users.id, u.id) });
  if (!user?.mfaSecretEnc || !verifyTotp(decryptSecret(user.mfaSecretEnc), str(fd, "code"))) {
    await audit({ userId: u.id, action: "auth.mfa_failed", entityType: "user", entityId: u.id, ip });
    throw new UserError("That code didn't match. Use the current 6-digit code from your authenticator app.");
  }
  await db.update(schema.sessions).set({ mfaPending: false }).where(eq(schema.sessions.id, u.sessionId));
  await audit({ userId: u.id, action: "auth.mfa_ok", entityType: "user", entityId: u.id, ip });
  redirect(safeNext(str(fd, "next"), u.isStaff ? "/admin" : "/account"));
});

export async function logoutAction() {
  const token = await getSessionToken();
  if (token) await destroySession(token);
  await clearSessionCookie();
  redirect("/");
}

const registerSchema = z.object({
  name: z.string().trim().min(2, "Enter your name.").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").or(z.literal("")),
  phone: z.string().trim(),
  password: z.string(),
  consent: z.literal("on", { errorMap: () => ({ message: "Accept the privacy notice to create an account." }) }),
});

export const registerAction = action(async (fd) => {
  const ip = await clientIp();
  if (!(await rateLimit(`register:${ip ?? "unknown"}`, 5, 3600))) throw new UserError("Too many accounts created from this connection. Try again later.");
  const data = registerSchema.parse({
    name: str(fd, "name"),
    email: str(fd, "email"),
    phone: str(fd, "phone"),
    password: String(fd.get("password") ?? ""),
    consent: fd.get("consent"),
  });
  const phone = data.phone ? normalizePhone(data.phone) : null;
  if (data.phone && !phone) throw new UserError("Check the phone number.", { phone: "Use a Kenyan mobile number like 0712 345 678." });
  if (!data.email && !phone) throw new UserError("Enter an email address or phone number.", { email: "Email or phone is required." });
  const pwErr = validatePasswordStrength(data.password);
  if (pwErr) throw new UserError(pwErr, { password: pwErr });
  const email = data.email ? normalizeEmail(data.email) : null;
  const clash = await db.query.users.findFirst({
    where: (u, { or, eq }) => or(email ? eq(u.email, email) : undefined, phone ? eq(u.phone, phone) : undefined),
  });
  if (clash) throw new UserError("An account with that email or phone already exists. Sign in or reset your password.");
  const role = await db.query.roles.findFirst({ where: eq(schema.roles.key, "CUSTOMER") });
  if (!role) throw new Error("Customer role missing");
  const userId = await db.transaction(async (tx) => {
    const [u] = await tx.insert(schema.users).values({ name: data.name, email, phone, passwordHash: await hashPassword(data.password), roleId: role.id }).returning();
    await tx.insert(schema.customers).values({
      userId: u.id,
      name: data.name,
      email,
      phone,
      marketingEmail: fd.get("marketing") === "on" && !!email,
      consentUpdatedAt: new Date(),
    });
    return u.id;
  });
  const { token, expiresAt } = await createSession(userId, { isStaff: false, mfaPending: false, ip });
  await setSessionCookie(token, expiresAt);
  await audit({ userId, action: "auth.register", entityType: "user", entityId: userId, ip });
  redirect(safeNext(str(fd, "next"), "/account"));
});

export const forgotPasswordAction = action(async (fd) => {
  const identifier = str(fd, "identifier");
  const ip = await clientIp();
  if (!(await rateLimit(`forgot:${ip ?? "unknown"}`, 5, 3600))) throw new UserError("Too many requests. Try again later.");
  const phone = normalizePhone(identifier);
  const email = identifier.includes("@") ? normalizeEmail(identifier) : null;
  const user = email || phone ? await db.query.users.findFirst({ where: email ? eq(schema.users.email, email) : eq(schema.users.phone, phone!) }) : null;
  if (user && user.status === "ACTIVE") {
    const token = randomToken(32);
    await db.transaction(async (tx) => {
      const [t] = await tx.insert(schema.passwordResetTokens).values({ tokenHash: sha256(token), userId: user.id, expiresAt: new Date(Date.now() + 3600_000) }).returning();
      await notify(tx, {
        event: "auth.password_reset",
        entityType: "password_reset",
        entityId: t.id,
        to: { name: user.name, email: user.email, phone: user.phone },
        vars: { resetUrl: `${process.env.APP_URL ?? ""}/reset-password?token=${token}` },
      });
    });
  }
  // Same response either way, so this form can't be used to discover accounts.
  return { ok: true, message: "If an account matches, we've sent a reset link. It works for 1 hour." };
});

export const resetPasswordAction = action(async (fd) => {
  const token = str(fd, "token");
  const password = String(fd.get("password") ?? "");
  const pwErr = validatePasswordStrength(password);
  if (pwErr) throw new UserError(pwErr, { password: pwErr });
  const row = await db.query.passwordResetTokens.findFirst({
    where: and(eq(schema.passwordResetTokens.tokenHash, sha256(token)), isNull(schema.passwordResetTokens.usedAt), gt(schema.passwordResetTokens.expiresAt, new Date())),
  });
  if (!row) throw new UserError("This reset link has expired or was already used. Request a new one.");
  await db.transaction(async (tx) => {
    await tx.update(schema.passwordResetTokens).set({ usedAt: new Date() }).where(eq(schema.passwordResetTokens.id, row.id));
    await tx.update(schema.users).set({ passwordHash: await hashPassword(password), passwordChangedAt: new Date(), failedLogins: 0, lockedUntil: null }).where(eq(schema.users.id, row.userId));
  });
  await destroyAllSessions(row.userId);
  await audit({ userId: row.userId, action: "auth.password_reset", entityType: "user", entityId: row.userId, ip: await clientIp() });
  redirect("/login?reset=1");
});
