/**
 * End-to-end checks against a running site (development or staging — never production).
 *
 *   E2E_BASE_URL=http://localhost:3000 npm run test:e2e
 *
 * Part 1 (always): HTTP checks — security headers, admin protection, cron and callback secrets.
 * Part 2 (browser): a guest buys a sample product and pays with the M-Pesa simulator; a cashier rings up a
 *   cash sale; a cashier is refused the reports page. Needs Playwright with a Chromium browser
 *   (`npx playwright install chromium`, or set CHROMIUM_PATH), MPESA_ENV=simulator on the site, and the
 *   sample data (`npm run db:seed:demo`). Skipped automatically if any of those are missing.
 */
import "dotenv/config";

const BASE = (process.env.E2E_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const DEMO_PASSWORD = process.env.E2E_DEMO_PASSWORD ?? "demo-password-123";
let failures = 0;

async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures++;
    console.log(`  ✗ ${name}\n      ${(e as Error).message}`);
  }
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function httpChecks() {
  console.log(`HTTP checks against ${BASE}`);
  await check("home page loads with security headers", async () => {
    const r = await fetch(BASE + "/");
    assert(r.status === 200, `status ${r.status}`);
    for (const h of ["content-security-policy", "x-content-type-options", "referrer-policy", "x-frame-options"]) assert(r.headers.get(h), `missing ${h}`);
  });
  await check("admin redirects to sign-in when signed out", async () => {
    const r = await fetch(BASE + "/admin", { redirect: "manual" });
    assert([302, 303, 307].includes(r.status) && (r.headers.get("location") ?? "").includes("/login"), `status ${r.status} → ${r.headers.get("location")}`);
  });
  await check("report export is not available signed out", async () => {
    const r = await fetch(BASE + "/admin/reports/export?report=sales-product", { redirect: "manual" });
    assert(r.status !== 200, `status ${r.status}`);
  });
  await check("customer data export needs a signed-in customer", async () => {
    const r = await fetch(BASE + "/account/export", { redirect: "manual" });
    assert(r.status !== 200, `status ${r.status}`);
  });
  await check("cron endpoint refuses requests without the secret", async () => {
    const r = await fetch(BASE + "/api/cron/tick");
    assert(r.status === 401 || r.status === 403, `status ${r.status}`);
  });
  await check("M-Pesa callback refuses a wrong secret path", async () => {
    const r = await fetch(BASE + "/api/payments/mpesa/callback/wrong-secret", { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
    assert(r.status === 404 || r.status === 403, `status ${r.status}`);
  });
  await check("order status needs the order's access key", async () => {
    const r = await fetch(BASE + "/api/orders/ORD-000001/status");
    assert(r.status === 404 || r.status === 403, `status ${r.status}`);
  });
}

async function browserChecks() {
  let pw: typeof import("playwright");
  try {
    pw = await import("playwright");
  } catch {
    console.log("Browser checks skipped: Playwright is not installed.");
    return;
  }
  let browser: import("playwright").Browser;
  try {
    browser = await pw.chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined });
  } catch (e) {
    console.log(`Browser checks skipped: no Chromium available (${(e as Error).message.split("\n")[0]}). Run "npx playwright install chromium" or set CHROMIUM_PATH.`);
    return;
  }
  const sample = await fetch(BASE + "/products/sample-rose-body-oil");
  if (sample.status !== 200) {
    console.log("Browser checks skipped: sample data not found (run npm run db:seed:demo on a development database).");
    await browser.close();
    return;
  }
  console.log("Browser checks");
  const newPage = async (mobile = false) => {
    const ctx = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, isMobile: true } : { viewport: { width: 1360, height: 900 } });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => {
      failures++;
      console.log(`      page error: ${e.message}`);
    });
    return page;
  };
  const login = async (page: import("playwright").Page, email: string) => {
    await page.goto(BASE + "/login");
    await page.fill("#identifier", email);
    await page.fill("#password", DEMO_PASSWORD);
    await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60000 }), page.click("button[type=submit]")]);
  };

  await check("guest checkout on a phone, paid with the M-Pesa simulator, gets a receipt", async () => {
    const page = await newPage(true);
    await page.goto(BASE + "/products/sample-rose-body-oil");
    await page.click("button:has-text('Add to cart')");
    await page.waitForSelector("text=Added to your cart");
    await page.goto(BASE + "/cart");
    await page.click("text=Go to checkout");
    await page.waitForURL("**/checkout");
    await page.fill("#name", "E2E Test Buyer");
    await page.fill("#phone", "0712345678");
    await page.fill("#email", "e2e@example.com");
    await page.check("input[name=acceptPolicies]");
    await Promise.all([page.waitForURL("**/orders/**", { timeout: 60000 }), page.click("button:has-text('Place order')")]);
    const mpesaButton = page.locator("button:has-text('with M-Pesa')");
    if (!(await mpesaButton.count())) throw new Error("No M-Pesa button — is MPESA_ENV=simulator set on the site?");
    await mpesaButton.click();
    await page.waitForSelector("text=Waiting for you to confirm", { timeout: 30000 });
    await page.click("text=Approve payment");
    await page.waitForSelector("a:has-text('Receipt')", { timeout: 30000 });
    const href = await page.getAttribute("a:has-text('Receipt')", "href");
    const res = await page.goto(BASE + href!);
    assert(res?.status() === 200, "receipt didn't open");
    await page.context().close();
  });

  await check("cashier completes a cash sale and prints the receipt", async () => {
    const page = await newPage();
    await login(page, "cashier@demo.local");
    await page.goto(BASE + "/admin/pos");
    if (await page.$("input[name=float]")) {
      await page.fill("input[name=float]", "2000");
      await page.click("button:has-text('Open shift')");
      await page.waitForSelector("text=Tap a product", { timeout: 30000 });
    }
    await page.click("button:has-text('Sample Black Seed Soap')");
    await page.waitForTimeout(800);
    await page.click("button:has-text('Take payment')");
    await page.locator("input[aria-label='Amount']").last().fill("500");
    await page.click("button:has-text('Complete sale')");
    await page.waitForSelector("text=Sale complete", { timeout: 30000 });
    const href = await page.getAttribute("a:has-text('Print receipt')", "href");
    assert(href, "no receipt link");
    await page.context().close();
  });

  await check("cashier can't open financial reports or the report export", async () => {
    const page = await newPage();
    await login(page, "cashier@demo.local");
    await page.goto(BASE + "/admin/reports");
    assert(!page.url().endsWith("/admin/reports") || (await page.locator("text=Gross profit by product").count()) === 0, "cashier saw reports");
    const r = await page.request.get(BASE + "/admin/reports/export?report=gross-profit");
    assert(r.status() === 403, `export status ${r.status()}`);
    await page.context().close();
  });

  await check("manager can download a report as CSV", async () => {
    const page = await newPage();
    await login(page, "manager@demo.local");
    const r = await page.request.get(BASE + "/admin/reports/export?report=sales-period&range=year");
    assert(r.status() === 200, `status ${r.status()}`);
    assert((r.headers()["content-type"] ?? "").includes("text/csv"), "not CSV");
    assert((await r.text()).includes("Gross sales (KES)"), "missing header");
    await page.context().close();
  });

  await browser.close();
}

(async () => {
  await httpChecks();
  await browserChecks();
  console.log(failures ? `\n${failures} check(s) failed.` : "\nAll checks passed.");
  process.exit(failures ? 1 : 0);
})();
