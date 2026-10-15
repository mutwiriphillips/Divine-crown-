/**
 * One-command first-run setup, safe to run on every start:
 *   1. apply database migrations
 *   2. seed roles, categories, settings and the draft catalogue (skipped once done)
 *   3. create the owner account from OWNER_EMAIL / OWNER_PASSWORD, only if no owner exists yet
 *
 * Used by hosts with no shell access (Render's free plan). Never resets an existing owner's password and
 * never creates sample data.   npm run bootstrap
 */
import "dotenv/config";
import "../src/lib/env-cleanup";
import { execFileSync } from "node:child_process";

const run = (script: string, env: Record<string, string | undefined> = {}) =>
  execFileSync("npx", ["tsx", script], { stdio: "inherit", env: { ...process.env, ...env } });

run("scripts/migrate.ts");
run("scripts/seed.ts");

(async () => {
  const { db, getPool, schema } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const role = await db.query.roles.findFirst({ where: eq(schema.roles.key, "OWNER") });
  const owner = role ? await db.query.users.findFirst({ where: eq(schema.users.roleId, role.id) }) : null;
  await getPool().end();
  if (owner) {
    console.log("Owner account already exists.");
  } else if (process.env.OWNER_EMAIL && process.env.OWNER_PASSWORD) {
    run("scripts/create-owner.ts");
    console.log("Remove OWNER_PASSWORD from the environment settings now. It is only needed once.");
  } else {
    console.log("No owner yet. Set OWNER_EMAIL and OWNER_PASSWORD, then redeploy (or run npm run create-owner).");
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
