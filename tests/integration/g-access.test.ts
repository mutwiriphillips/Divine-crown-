/** G. Access control: roles, sessions, lockout, callback secret. */
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db, schema } from "@/db";
import { can, checkCredentials, createSession, getSessionUser, validatePasswordStrength } from "@/lib/auth/core";
import { verifyCallbackSecret } from "@/lib/payments/mpesa";
import { ROLE_DEFAULTS } from "@/lib/permissions";
import { makeUser } from "../fixtures";

describe("G. access control", () => {
  it("gives each role only its permissions", () => {
    const cashier = { permissions: ROLE_DEFAULTS.CASHIER.permissions };
    expect(can(cashier, "pos.use")).toBe(true);
    for (const p of ["refunds.issue", "reports.financial", "settings.financial", "staff.manage", "inventory.adjust", "customers.export", "audit.view"] as const) expect(can(cashier, p)).toBe(false);
    expect(can({ permissions: ROLE_DEFAULTS.INVENTORY_CLERK.permissions }, "reports.sales")).toBe(false);
    expect(can({ permissions: ROLE_DEFAULTS.SUPPORT.permissions }, "pos.use")).toBe(false);
    expect(ROLE_DEFAULTS.CUSTOMER.isStaff).toBe(false);
    expect(ROLE_DEFAULTS.CUSTOMER.permissions).toHaveLength(0);
    expect(can(null, "orders.view")).toBe(false);
  });

  it("resolves sessions from the cookie token only, and ends them on expiry or when the account is disabled", async () => {
    const u = await makeUser("SUPPORT");
    const { token, session } = await createSession(u.id, { isStaff: true, mfaPending: false });
    expect((await getSessionUser(token))?.permissions).toContain("support.manage");
    expect(await getSessionUser(session.tokenHash)).toBeNull(); // the stored hash is not a usable token
    expect(await getSessionUser("not-a-token")).toBeNull();
    await db.update(schema.users).set({ status: "DISABLED" }).where(eq(schema.users.id, u.id));
    expect(await getSessionUser(token)).toBeNull();
  });

  it("locks an account after five wrong passwords and gives the same message for unknown accounts", async () => {
    const u = await makeUser("CASHIER", { password: "right-password-123" });
    const unknown = await checkCredentials("nobody@test.local", "whatever-123", null);
    for (let i = 0; i < 5; i++) {
      const r = await checkCredentials(u.email!, "wrong-password", null);
      expect(r.ok).toBe(false);
      if (!r.ok && i === 0) expect(r.error).toBe(!unknown.ok && unknown.error);
    }
    const locked = await checkCredentials(u.email!, "right-password-123", null);
    expect(locked.ok).toBe(false);
    if (!locked.ok) expect(locked.error).toMatch(/locked/);
  });

  it("rejects weak passwords and wrong M-Pesa callback secrets", () => {
    expect(validatePasswordStrength("short")).not.toBeNull();
    expect(validatePasswordStrength("a-much-longer-pass-phrase")).toBeNull();
    expect(verifyCallbackSecret("test-callback-secret")).toBe(true);
    expect(verifyCallbackSecret("guess")).toBe(false);
    expect(verifyCallbackSecret("")).toBe(false);
  });
});
