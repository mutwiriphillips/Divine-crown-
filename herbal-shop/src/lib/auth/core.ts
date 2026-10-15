import bcrypt from "bcryptjs";
import { and, eq, gt, or, sql } from "drizzle-orm";
import { db, schema, type Executor } from "@/db";
import { audit } from "@/lib/audit";
import { randomToken, sha256 } from "@/lib/crypto";
import type { Permission } from "@/lib/permissions";

export const PASSWORD_MIN = 10;
const BCRYPT_COST = 12;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
export const STAFF_SESSION_HOURS = 12;
export const CUSTOMER_SESSION_DAYS = 30;

export class AuthError extends Error {
  constructor(message = "Please sign in to continue.") {
    super(message);
    this.name = "AuthError";
  }
}
export class ForbiddenError extends Error {
  constructor(message = "You don't have permission to do that.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export function validatePasswordStrength(pw: string): string | null {
  if (pw.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (pw.length > 200) return "Use at most 200 characters.";
  if (/^(.)\1+$/.test(pw)) return "Choose a password that isn't one repeated character.";
  const common = ["password12", "1234567890", "qwertyuiop", "password123", "letmein123"];
  if (common.includes(pw.toLowerCase())) return "That password is too common.";
  return null;
}

export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, BCRYPT_COST);
}

export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash);
}

// A real bcrypt hash used to keep timing similar when the account does not exist.
const DUMMY_HASH = "$2a$12$OJb/Kps5i3SOlbg0Dw1Um.ZCNJU.Pz.7oHj9QreAESN930ApPqayW";

export function normalizePhone(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, "");
  let d = digits.startsWith("+") ? digits.slice(1) : digits;
  if (/^0[17]\d{8}$/.test(d)) d = "254" + d.slice(1);
  if (/^[17]\d{8}$/.test(d)) d = "254" + d;
  if (/^254[17]\d{8}$/.test(d)) return d;
  return null;
}

export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

export type SessionUser = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  roleKey: string;
  roleName: string;
  isStaff: boolean;
  permissions: string[];
  mfaEnabled: boolean;
  sessionId: string;
  mfaPending: boolean;
};

export async function createSession(
  userId: string,
  opts: { isStaff: boolean; mfaPending: boolean; ip?: string | null; userAgent?: string | null },
  exec: Executor = db,
) {
  const token = randomToken(32);
  const ms = opts.isStaff ? STAFF_SESSION_HOURS * 3600_000 : CUSTOMER_SESSION_DAYS * 86400_000;
  const expiresAt = new Date(Date.now() + ms);
  const [s] = await exec
    .insert(schema.sessions)
    .values({
      tokenHash: sha256(token),
      userId,
      mfaPending: opts.mfaPending,
      expiresAt,
      ip: opts.ip ?? null,
      userAgent: opts.userAgent?.slice(0, 300) ?? null,
    })
    .returning();
  return { token, session: s, expiresAt };
}

export async function getSessionUser(token: string | undefined | null): Promise<SessionUser | null> {
  if (!token) return null;
  const rows = await db
    .select({
      sessionId: schema.sessions.id,
      expiresAt: schema.sessions.expiresAt,
      mfaPending: schema.sessions.mfaPending,
      lastSeenAt: schema.sessions.lastSeenAt,
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      phone: schema.users.phone,
      status: schema.users.status,
      mfaEnabled: schema.users.mfaEnabled,
      roleKey: schema.roles.key,
      roleName: schema.roles.name,
      isStaff: schema.roles.isStaff,
      permissions: schema.roles.permissions,
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .innerJoin(schema.roles, eq(schema.roles.id, schema.users.roleId))
    .where(and(eq(schema.sessions.tokenHash, sha256(token)), gt(schema.sessions.expiresAt, new Date())))
    .limit(1);
  const r = rows[0];
  if (!r || r.status !== "ACTIVE") return null;
  // Touch at most every 5 minutes to avoid a write per request.
  if (Date.now() - r.lastSeenAt.getTime() > 5 * 60_000) {
    await db.update(schema.sessions).set({ lastSeenAt: new Date() }).where(eq(schema.sessions.id, r.sessionId));
  }
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    phone: r.phone,
    roleKey: r.roleKey,
    roleName: r.roleName,
    isStaff: r.isStaff,
    permissions: r.permissions,
    mfaEnabled: r.mfaEnabled,
    sessionId: r.sessionId,
    mfaPending: r.mfaPending,
  };
}

export async function destroySession(token: string) {
  await db.delete(schema.sessions).where(eq(schema.sessions.tokenHash, sha256(token)));
}

export async function destroyAllSessions(userId: string, exceptSessionId?: string) {
  await db
    .delete(schema.sessions)
    .where(
      exceptSessionId
        ? and(eq(schema.sessions.userId, userId), sql`${schema.sessions.id} <> ${exceptSessionId}`)
        : eq(schema.sessions.userId, userId),
    );
}

export type LoginResult =
  | { ok: true; userId: string; isStaff: boolean; mfaRequired: boolean }
  | { ok: false; error: string };

/** Password check with account lockout. Error messages never reveal whether the account exists. */
export async function checkCredentials(identifier: string, password: string, ip: string | null): Promise<LoginResult> {
  const generic = "That email/phone and password don't match. Check them and try again.";
  const id = identifier.trim();
  const phone = normalizePhone(id);
  const email = id.includes("@") ? normalizeEmail(id) : null;
  if (!phone && !email) {
    await verifyPassword(password, DUMMY_HASH);
    return { ok: false, error: generic };
  }
  const user = await db.query.users.findFirst({
    where: or(email ? eq(schema.users.email, email) : sql`false`, phone ? eq(schema.users.phone, phone) : sql`false`),
    with: { role: true },
  });
  if (!user) {
    await verifyPassword(password, DUMMY_HASH);
    return { ok: false, error: generic };
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    return { ok: false, error: "This account is temporarily locked after several failed attempts. Try again in 15 minutes or reset your password." };
  }
  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid || user.status !== "ACTIVE") {
    const failed = user.failedLogins + 1;
    const lock = failed >= MAX_FAILED;
    await db
      .update(schema.users)
      .set({ failedLogins: lock ? 0 : failed, lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null })
      .where(eq(schema.users.id, user.id));
    await audit({ userId: user.id, action: lock ? "auth.locked" : "auth.login_failed", entityType: "user", entityId: user.id, ip });
    return { ok: false, error: generic };
  }
  await db
    .update(schema.users)
    .set({ failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() })
    .where(eq(schema.users.id, user.id));
  return { ok: true, userId: user.id, isStaff: user.role.isStaff, mfaRequired: user.mfaEnabled };
}

export function can(user: Pick<SessionUser, "permissions"> | null | undefined, p: Permission): boolean {
  return !!user && user.permissions.includes(p);
}
