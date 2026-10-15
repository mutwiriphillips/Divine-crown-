import { testDatabaseUrl } from "./test-db";

process.env.DATABASE_URL = testDatabaseUrl();
process.env.APP_URL = "http://localhost:3000";
process.env.APP_SECRET = "test-secret-test-secret-test-secret-0123456789";
process.env.MPESA_ENV = "simulator";
process.env.MPESA_CALLBACK_SECRET = "test-callback-secret";
// No notification providers: every message is recorded and then skipped, unless a test sets one.
for (const k of ["SMTP_URL", "RESEND_API_KEY", "AT_API_KEY", "AT_USERNAME", "WHATSAPP_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"]) delete process.env[k];
