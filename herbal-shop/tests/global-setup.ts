import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client, Pool } from "pg";
import { ROLE_DEFAULTS } from "../src/lib/permissions";
import { testDatabaseUrl } from "./test-db";

export default async function setup() {
  const url = new URL(testDatabaseUrl());
  const name = url.pathname.slice(1);
  const admin = new URL(url);
  admin.pathname = "/postgres";
  const c = new Client({ connectionString: admin.toString() });
  await c.connect();
  await c.query(`drop database if exists "${name}" with (force)`);
  await c.query(`create database "${name}"`);
  await c.end();

  const pool = new Pool({ connectionString: url.toString() });
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  for (const [key, def] of Object.entries(ROLE_DEFAULTS)) {
    await pool.query(`insert into roles (key, name, description, permissions, is_staff) values ($1,$2,$3,$4,$5)`, [key, def.name, def.description, def.permissions, def.isStaff]);
  }
  await pool.query(`insert into locations (name, code, is_default) values ('Test shop', 'MAIN', true)`);
  await pool.query(`insert into expense_categories (name) values ('Rent'), ('Transport')`);
  await pool.end();
}
