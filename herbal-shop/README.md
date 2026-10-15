# Herbal shop — online store, till and back office

One web app for the shop. It has three parts:

- **Storefront.** Catalogue, cart, checkout with M-Pesa or cash on delivery, and order tracking. Customers get accounts, can leave reviews and ask for support, and can export their own data.
- **Point of sale.** Runs in the browser on any tablet or PC. Covers shifts and cash drawer counts, receipts on 58 mm or 80 mm paper, and A4 or PDF.
- **Admin.** Products, stock and batches, purchasing and suppliers, orders, payments, refunds, delivery, customers, promotions, expenses, reports with CSV export, staff and roles, two-step sign-in, an audit log and privacy requests.

Built with Next.js 15 (App Router), PostgreSQL, Drizzle ORM and Tailwind CSS. Money is always stored as whole cents in KES.

> **Status:** This is a complete working application. It is **not yet connected** to Safaricom, an email provider, SMS, WhatsApp, KRA eTIMS or a courier. Each of those needs your own accounts and credentials; see [Going live](#going-live). Nothing in the app pretends to be connected. Unconfigured channels are clearly shown as "not set up" in **Admin → Settings → Integrations**, and messages for them are recorded and marked "skipped".

---

## Contents

1. [Run it on your computer](#run-it-on-your-computer)
2. [How it's organised](#how-its-organised)
3. [Products from your photos: what to check](#products-from-your-photos-what-to-check)
4. [Going live](#going-live)
5. [Deployment](#deployment)
6. [Backups and recovery](#backups-and-recovery)
7. [Tests](#tests)
8. [Security notes](#security-notes)
9. [Not included yet](#not-included-yet)

---

## Run it on your computer

You need **Node.js 22+** and **PostgreSQL 14+**.

```bash
npm install
cp .env.example .env          # then fill in DATABASE_URL, APP_URL, APP_SECRET, CRON_SECRET
                              # for local testing also set MPESA_ENV=simulator
npm run db:migrate            # create the tables
npm run db:seed               # roles, categories, settings and the draft catalogue from ./seed-photos
OWNER_EMAIL=you@example.com OWNER_NAME="Your Name" OWNER_PASSWORD='a long passphrase' npm run create-owner
npm run dev                   # http://localhost:3000   (admin at /admin)
npm run worker                # in a second terminal: sends messages, releases stock holds, checks payments
```

### Sample data for trying things out

```bash
npm run db:seed:demo          # sample staff, a sample customer, 4 "Sample …" products, delivery zones, code SAMPLE10
npm run db:purge-demo -- --yes  # removes ALL sample data again, including sample orders
```

Sample logins all use the password `demo-password-123`:

- manager@demo.local
- cashier@demo.local
- clerk@demo.local
- support@demo.local
- customer@demo.local

Sample products, zones and promotions are named "Sample …", and the dashboard warns while any sample orders exist. Remove them before going live. Sample seeding refuses to run when `NODE_ENV=production`.

### M-Pesa simulator

With `MPESA_ENV=simulator`, the order page shows **Approve payment / Cancel on phone / Insufficient funds** buttons in place of a real phone prompt. They send the same callback Safaricom would, through the same code path. The simulator is switched off automatically when `NODE_ENV=production`, unless you set `ALLOW_PAYMENT_SIMULATOR=true`, which is for a private staging site only.

---

## How it's organised

```
src/app/(shop)       storefront, checkout, customer account
src/app/(auth)       sign-in, registration, two-step sign-in, password reset
src/app/admin        back office (one folder per section) and the POS (admin/pos)
src/app/api          M-Pesa callback, payment simulator, order status polling, cron tick
src/app/documents    receipts, invoices and credit notes (print and PDF)
src/lib              business rules: inventory, pricing, orders, payments, refunds, POS, purchasing,
                     reports, notifications, jobs, auth, settings, storage, claims checks
src/db/schema.ts     database tables;  drizzle/  SQL migrations (incl. integrity triggers)
scripts/             migrate, seed, demo data, create-owner, worker, backup/restore
tests/               integration tests (A–J) and end-to-end checks
```

These rules hold everywhere:

- **The server decides every price.** Checkout and the POS recalculate prices, discounts, delivery and VAT on the server. If the customer's screen showed a different total, the order is refused and they are asked to review it. Nothing is charged at a different amount.
- **Stock changes go through one function** (`applyMovement`). It uses a conditional update, so stock can never go below zero, even when two customers buy the last item at the same moment. Every change is written to an append-only ledger (`stock_movements`) with a reason and the user who made it.
- **Online orders reserve stock while the customer pays.** Unpaid orders are released automatically after the reservation window. Stock is deducted only once payment is confirmed.
- **Financial records are never edited or deleted.** Payments, refunds, documents and audit logs are protected by database triggers. Corrections are new records: a refund, a credit note, a reversal.
- **An order is marked paid in one place only** (`recordPayment`). For M-Pesa that happens after a verified callback. In live modes the callback is also confirmed with an STK status query, and the M-Pesa receipt number is unique, so duplicates are blocked.
- **Retries are safe.** Checkout, POS sales, refunds and goods receipts all carry an idempotency key, and callbacks are idempotent, so a double click or a resent callback never sells or charges twice.
- **Messages go through an outbox.** Notifications are queued in the same transaction as the sale, then sent by the worker with retries. If a provider is down, the message is retried later; the sale is never undone.
- **Documents are titled honestly.** Receipts are titled "Payment receipt" unless you are VAT-registered, have set your KRA PIN and have confirmed eTIMS. Even then, the app does not transmit to KRA itself (see below).

### Roles

The built-in roles are Owner, Manager, Cashier, Inventory clerk, Sales & support, and Customer. Their permissions can be changed in **Admin → Settings → Staff**. Every admin page and action checks a specific permission on the server. Hiding a button is never the only protection.

---

## Products from your photos: what to check

`npm run db:seed` creates **draft** products from the 20 photos in `seed-photos/`. All of them are marked **Needs review**, and none can be published until that is cleared. Only facts visible in the photos were used. Where something couldn't be read, it was left empty and explained in the product's review note. Open **Admin → Products → filter "Needs review"** and go through each one.

Points that need your decision before publishing:

| Product | What to check |
|---|---|
| **BabaPlus Homens** | It is presented as a men's health supplement. Products like this generally need registration with the Pharmacy and Poisons Board (PPB). Confirm its registration before selling. |
| **Slimfast Herbal Tea** | The name may conflict with an existing weight-loss trademark, and weight-loss wording is flagged by the claims check. |
| **Red-and-black seeds** (unidentified) | These look like rosary pea (*Abrus precatorius*) seeds, which are toxic if chewed or swallowed. Identify them before selling, and add a warning if they are sold. |
| **Mvuto Powder (Business Boost)** | The photo looks like a design mock-up rather than a real package. It is kept in the image library only, so take a real photo. |
| **Ngekewa oil** | The label reads "Ngekewa", not "Ngekewe". The product name follows the label. |
| **Prices** | Only two prices appear in your photos: Attraction Pack KES 2,000 and Sai Flora incense KES 400 per box. Both are flagged for you to confirm. Every other product has no price and can't be sold until you add one. |
| Three unlabelled items | A powder, white crystals and seeds. Name them, and record their contents and weight. |

The **claims check** (`src/lib/claims.ts`) flags wording about cures, medical effects, guaranteed money, love or luck, and similar. A flagged product can only be published after an Owner approves its wording, and every approval is audited. Many product names here make such promises. Whether and how to sell them is your decision. The app keeps those claims out of the generated descriptions and shows a standard disclaimer for each product type.

---

## Going live

Work through **Admin → Settings → Integrations**. It shows what is and isn't configured, without ever showing secret values.

1. **Business details** (Admin → Settings): name, phone, address, KRA PIN if you have one, and your delivery, returns, privacy and terms text. Have the policies reviewed by someone qualified. The defaults are a starting point, not legal advice.
2. **M-Pesa (Safaricom Daraja).**
   - Create an app on developer.safaricom.co.ke and test with `MPESA_ENV=sandbox`.
   - Then apply for **Go-Live** on your Paybill or Till to get production credentials and the passkey.
   - Set the `MPESA_*` variables. `MPESA_CALLBACK_BASE_URL` must be your public HTTPS address.
   - Safaricom will call `https://your-site/api/payments/mpesa/callback/<MPESA_CALLBACK_SECRET>`.
   - Make a small real payment and check it in **Admin → Payments**.
   - M-Pesa refunds are **recorded** in the app and marked "payout pending" until you send the money from the M-Pesa portal. Automatic reversals (B2C or Reversal API) are not built in.
3. **Email.** Set `RESEND_API_KEY` or `SMTP_URL`, plus `EMAIL_FROM`, and verify your sending domain (SPF and DKIM).
4. **SMS.** Use an Africa's Talking account with a sender ID; set `AT_USERNAME` and `AT_API_KEY`.
5. **WhatsApp.** Use the Meta WhatsApp Business Cloud API. Business-initiated messages need an approved template (`WHATSAPP_TEMPLATE_NAME`).
6. **eTIMS (KRA).** Not integrated. If you are VAT-registered, keep issuing tax invoices through your eTIMS-compliant system. The app labels its documents as payment receipts unless you tick "eTIMS confirmed" in settings, and even then nothing is sent to KRA. Ask your tax adviser.
7. **Courier.** Not integrated. Record the courier name and tracking reference on each delivery by hand.
8. **Remove sample data**: `npm run db:purge-demo -- --yes`. Then check that no "Sample …" items remain.
9. **Turn on two-step sign-in** for every owner and manager (Admin → Account), and enable the reminder in Settings.
10. **Schedule backups and test a restore** (see below).

---

## Deployment

### Option A — your own server (recommended to start)

A small VPS (2 GB RAM) runs everything with Docker:

```bash
cp .env.example .env                 # fill in; DATABASE_URL=postgres://shop:<POSTGRES_PASSWORD>@db:5432/shop
docker compose up -d --build
docker compose exec web npm run db:migrate
docker compose exec web npm run db:seed
docker compose exec web npm run create-owner    # with OWNER_* set in .env, then remove them
```

Put Caddy or nginx in front for HTTPS; the app listens on `127.0.0.1:3000`. A minimal Caddyfile:

```
shop.example.co.ke {
  reverse_proxy 127.0.0.1:3000
}
```

You can run without Docker too. Use `npm ci && npm run build`, then run `npm start` and `npm run worker` under systemd or pm2, with Postgres installed locally or managed.

### Option B — Vercel + managed Postgres

1. Use a managed Postgres (Neon, Supabase or similar) and set `DATABASE_SSL=true`.
2. Set `STORAGE_DRIVER=s3` with an S3-compatible bucket (Cloudflare R2, AWS S3), because serverless disks are not kept.
3. `vercel.json` calls `/api/cron/tick` every minute. Vercel sends `CRON_SECRET` as a Bearer token. Per-minute cron needs a paid Vercel plan; on other hosts, call the same URL every minute from any scheduler with `Authorization: Bearer $CRON_SECRET`.
4. Run `npm run db:migrate` against the production database from your machine or CI before each release.

### Every release

```bash
npm ci && npm run lint && npm test && npm run build && npm run db:migrate
```

Migrations are plain SQL in `drizzle/`. Take a backup before running them.

### Monitoring

Set `ERROR_WEBHOOK_URL` to get a short message for each server error (no customer data is included). The worker logs to stdout. **Admin → Payments** shows M-Pesa requests that never got an answer, and **Admin → Settings → Notifications** shows failed messages.

---

## Backups and recovery

```bash
npm run db:backup                         # ./backups/<timestamp>/database.dump + storage.tar.gz + checksums
BACKUP_DIR=/mnt/offsite npm run db:backup # somewhere else; keeps the last 14 (BACKUP_KEEP)
npm run db:restore -- ./backups/<timestamp>   # asks you to type the database name first
```

- Run a backup at least daily from cron, for example `15 2 * * * cd /srv/shop && npm run db:backup`, and **copy it off the server**.
- With Docker: `docker compose exec web npm run db:backup`, and mount `/app/backups` to a volume you copy elsewhere.
- Uploaded files: with local storage, they are included in `storage.tar.gz`. With S3, turn on versioning on both buckets.
- **Test a restore** into a scratch database every few months: point `DATABASE_URL` at it and run `db:restore`.
- Managed Postgres providers also offer point-in-time recovery; turn it on.

If something goes wrong:

- **Stop the web app and the worker**, so no new sales are recorded.
- **Restore the latest good backup.**
- **Start the app and the worker again.**
- **Re-check the M-Pesa statement.** Payments made after the backup can be matched in **Admin → Payments**. The reconciliation job also re-queries any pending requests.

---

## Tests

```bash
npm test               # integration tests A–J against a throwaway database (see below)
npm run test:e2e       # HTTP and browser checks against a running dev/staging site
npm run lint           # type check
```

**Integration tests** run on a separate database. It is **dropped and re-created on every run**:

- Set `TEST_DATABASE_URL` to choose it (its name must contain "test").
- Otherwise they use your `DATABASE_URL` server with a database named `shop_test`.

| | Covers |
|---|---|
| **A. Online sale** | Server pricing, a tampered total refused, idempotent checkout, reservation, M-Pesa confirmation, stock committed once, receipt, last-unit race |
| **B. Failed and pending payments** | Cancelled prompt, retry, prompt throttling, underpayment, malformed or unknown callbacks, expiry releasing stock |
| **C. POS** | One open shift per cashier, change, duplicate submit, short payment, split cash + M-Pesa, reused M-Pesa code, permissions, products under review, shift variance |
| **D. Stock receiving and adjustment** | Partial receiving, over-receiving refused, weighted average cost, supplier balance, batch numbers, quarantine, never negative, immutable ledger |
| **E. Refunds** | Partial refund, restock by condition, credit note, drawer movement, idempotency, over-refund refused, M-Pesa payout tracking, records can't be deleted |
| **F. Feedback** | Verified-purchase reviews, one per product, hidden until approved, rating limits, claims check |
| **G. Access control** | Role permissions, session tokens, disabled accounts, lockout after 5 attempts, generic errors, password rules, callback secret |
| **H. Report reconciliation** | Dashboard, breakdowns, reports and CSV agree with the raw records |
| **I. Repeated callback** | The same callback sent 4 times (3 at once) → one payment, one stock deduction, one receipt, all logged |
| **J. Failed notification** | A provider outage is retried with backoff and later sent; the sale is unaffected |

**End-to-end checks** (`tests/e2e/run.ts`) always run the HTTP checks: security headers, admin protection, the cron secret and the callback secret. With Playwright and a Chromium browser available (`npx playwright install chromium`), they also run the browser checks:

- a guest buys on a phone-sized screen and pays with the simulator;
- a cashier completes a sale;
- a cashier is refused the reports and their CSV export;
- a manager downloads a report CSV.

The browser checks need `MPESA_ENV=simulator` and the sample data. Point them at a site with `E2E_BASE_URL`.

---

## Security notes

- **Secrets** live only in environment variables. Nothing secret is sent to the browser, and `.env` is git-ignored.
- **Passwords** are stored with bcrypt (cost 12).
  - Sign-in is rate-limited per address and per account, and an account locks after 5 failures.
  - Unknown accounts get the same error and timing as wrong passwords.
- **Two-step sign-in** uses TOTP. The secrets are encrypted at rest (AES-GCM with a key derived from `APP_SECRET`).
- **Sessions** use random tokens. Only a hash of the token is stored, in an httpOnly, SameSite=Lax cookie that is Secure in production. Staff sessions expire after 12 hours. Changing a password signs out other sessions.
- **Server actions** have Next.js's built-in origin check. Every admin action re-checks permissions on the server.
- **Security headers** include a Content-Security-Policy, X-Frame-Options DENY, nosniff, Referrer-Policy and Permissions-Policy (`next.config.ts`).
- **M-Pesa callbacks**:
  - They arrive on a secret path, compared in constant time. An optional allow-list of IP addresses is supported.
  - In live modes, success is confirmed with a status query.
  - Every callback is logged with a hash of its payload.
- **Uploads** are checked by their content, not by file name. Images are re-encoded, which strips EXIF and location data. Expense attachments are stored privately and only served to staff with permission.
- **Customer data**:
  - Contact details are masked for roles without `customers.view_contact`.
  - Exports are permission-checked and audited, and CSV cells are protected against formula injection.
  - Customers can download their data and ask for deletion. Deletion anonymises the person but keeps financial records, which you are generally required to keep.
- The app supports the record-keeping and privacy practices expected under Kenya's Data Protection Act. It **does not by itself make you compliant**: registration with the ODPC, your privacy notice and your retention periods are for you and your advisers.

---

## Not included yet

These are deliberately left out. The app says so where they would appear instead of pretending otherwise.

- **Offline POS.** The till needs an internet connection. If the connection drops, a sale isn't lost silently: it fails with a message and can be retried safely.
- **Loyalty points and store credit.**
- **Sending newsletters.** Subscribers and consent are collected and can be exported for a mailing tool.
- **KRA eTIMS transmission**, **courier APIs** and **automatic M-Pesa refunds** (B2C or Reversal).
- **Card payments.** The POS can record a card payment taken on a separate terminal; there is no online card gateway.
