import "dotenv/config";

/**
 * Integration tests run against a separate, throwaway database. It is DROPPED and re-created on every run,
 * so it must never point at real data. Set TEST_DATABASE_URL, or the tests use DATABASE_URL with the
 * database name replaced by "shop_test".
 */
export function testDatabaseUrl() {
  const explicit = process.env.TEST_DATABASE_URL;
  const base = explicit ?? process.env.DATABASE_URL;
  if (!base) throw new Error("Set TEST_DATABASE_URL (or DATABASE_URL) to run the integration tests.");
  const u = new URL(base);
  if (!explicit) u.pathname = "/shop_test";
  if (!/test/i.test(u.pathname)) throw new Error(`Refusing to run tests against "${u.pathname.slice(1)}": the test database name must contain "test".`);
  return u.toString();
}
