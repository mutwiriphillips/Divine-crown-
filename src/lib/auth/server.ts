import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { Permission } from "@/lib/permissions";
import { AuthError, ForbiddenError, getSessionUser, type SessionUser } from "./core";

export const SESSION_COOKIE = "sid";

export async function setSessionCookie(token: string, expiresAt: Date) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "true",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

export async function getSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

/** Current signed-in user (fully authenticated, MFA complete), memoised per request. */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const u = await getSessionUser(await getSessionToken());
  if (!u || u.mfaPending) return null;
  return u;
});

export const getPendingMfaUser = cache(async (): Promise<SessionUser | null> => {
  const u = await getSessionUser(await getSessionToken());
  return u && u.mfaPending ? u : null;
});

export async function clientIp(): Promise<string | null> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  return (fwd ? fwd.split(",")[0].trim() : h.get("x-real-ip")) || null;
}

// ── For server actions: throw, so the action returns an error ──

export async function requireUser(): Promise<SessionUser> {
  const u = await getCurrentUser();
  if (!u) throw new AuthError();
  return u;
}

export async function requirePermission(p: Permission): Promise<SessionUser> {
  const u = await requireUser();
  if (!u.isStaff || !u.permissions.includes(p)) throw new ForbiddenError();
  return u;
}

// ── For pages: redirect ──

export async function requireStaffPage(p?: Permission, next = "/admin"): Promise<SessionUser> {
  const u = await getCurrentUser();
  if (!u) redirect(`/login?next=${encodeURIComponent(next)}`);
  if (!u.isStaff) redirect("/account");
  if (p && !u.permissions.includes(p)) redirect("/admin/forbidden");
  return u;
}

export async function requireCustomerPage(next = "/account"): Promise<SessionUser> {
  const u = await getCurrentUser();
  if (!u) redirect(`/login?next=${encodeURIComponent(next)}`);
  return u;
}
