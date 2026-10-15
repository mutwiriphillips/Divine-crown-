/**
 * Create (or reset the password of) the owner account.
 *   OWNER_EMAIL=you@example.com OWNER_NAME="Your Name" OWNER_PASSWORD='a long password' npm run create-owner
 * If OWNER_PASSWORD is omitted, a strong password is generated and printed once.
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { db, getPool, schema } from "@/db";
import { hashPassword, normalizeEmail, validatePasswordStrength } from "@/lib/auth/core";
import { randomToken } from "@/lib/crypto";

async function main() {
  const email = process.env.OWNER_EMAIL ? normalizeEmail(process.env.OWNER_EMAIL) : null;
  const name = process.env.OWNER_NAME ?? "Owner";
  if (!email) throw new Error("Set OWNER_EMAIL");
  const generated = !process.env.OWNER_PASSWORD;
  const password = process.env.OWNER_PASSWORD ?? randomToken(15);
  const err = validatePasswordStrength(password);
  if (err) throw new Error(err);
  const role = await db.query.roles.findFirst({ where: eq(schema.roles.key, "OWNER") });
  if (!role) throw new Error("Run npm run db:seed first");
  const existing = await db.query.users.findFirst({ where: eq(schema.users.email, email) });
  if (existing) {
    await db.update(schema.users).set({ passwordHash: await hashPassword(password), roleId: role.id, status: "ACTIVE", failedLogins: 0, lockedUntil: null }).where(eq(schema.users.id, existing.id));
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, existing.id));
    console.log(`Owner ${email} updated.`);
  } else {
    await db.insert(schema.users).values({ email, name, passwordHash: await hashPassword(password), roleId: role.id });
    console.log(`Owner ${email} created.`);
  }
  if (generated) console.log(`Password (shown once): ${password}`);
  await getPool().end();
}

main().catch(async (e) => {
  console.error(e.message ?? e);
  await getPool().end();
  process.exit(1);
});
