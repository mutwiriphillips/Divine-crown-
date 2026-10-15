/**
 * Apply database migrations. Safe to run on every deploy and from several processes at once:
 * a Postgres advisory lock makes concurrent runs wait for each other.
 *   npm run db:migrate
 */
import "dotenv/config";
import "../src/lib/env-cleanup";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getPool } from "@/db";

async function main() {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock(727274)");
    await migrate(drizzle(client), { migrationsFolder: path.join(process.cwd(), "drizzle") });
    await client.query("select pg_advisory_unlock(727274)");
  } finally {
    client.release();
    await pool.end();
  }
  console.log("Migrations applied.");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
