import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireStaffPage } from "@/lib/auth/server";
import { channelConfigured } from "@/lib/notifications/providers";
import { mpesaMode } from "@/lib/payments/mpesa";
import { Badge, fmtDate, PageHeader } from "@/components/ui";

export const metadata = { title: "Integrations" };

function Row({ name, status, tone, detail, todo }: { name: string; status: string; tone: "ok" | "warn" | "bad"; detail: string; todo?: string }) {
  return (
    <tr>
      <td className="font-semibold">{name}</td>
      <td><Badge tone={tone}>{status}</Badge></td>
      <td className="text-sm">{detail}{todo ? <span className="mt-1 block text-ink-soft">To finish: {todo}</span> : null}</td>
    </tr>
  );
}

/** Shows what's connected. Never displays secret values — only whether they're set. */
export default async function IntegrationsPage() {
  await requireStaffPage("settings.financial", "/admin/settings/integrations");
  const mode = mpesaMode();
  const missing = ["MPESA_CONSUMER_KEY", "MPESA_CONSUMER_SECRET", "MPESA_SHORTCODE", "MPESA_PASSKEY", "MPESA_CALLBACK_BASE_URL", "MPESA_CALLBACK_SECRET"].filter((k) => !process.env[k]);
  const lastJob = await db.execute<{ at: Date | null }>(sql`select max(finished_at) as at from jobs where status = 'SUCCEEDED'`);
  const lastJobAt = lastJob.rows[0]?.at ? new Date(lastJob.rows[0].at) : null;
  const workerOk = !!lastJobAt && Date.now() - lastJobAt.getTime() < 15 * 60_000;
  return (
    <>
      <PageHeader title="Integrations" description="What's connected, and what still needs credentials or approval. Credentials are set as environment variables on the server, never in this screen." />
      <div className="card overflow-x-auto">
        <table className="table">
          <thead><tr><th>Service</th><th>Status</th><th>Details</th></tr></thead>
          <tbody>
            <Row
              name="M-Pesa (Daraja STK Push)"
              status={mode === "production" ? "Live" : mode === "sandbox" ? "Sandbox (test money)" : mode === "simulator" ? "Simulator (no real payments)" : "Not connected"}
              tone={mode === "production" ? "ok" : mode === "disabled" ? "bad" : "warn"}
              detail={mode === "simulator" ? "Payments are simulated on this server. No money moves." : mode === "disabled" ? `Missing: ${missing.join(", ") || "MPESA_ENV"}` : `Callbacks go to ${process.env.MPESA_CALLBACK_BASE_URL ?? "(not set)"}/api/payments/mpesa/callback/…`}
              todo={mode !== "production" ? "Apply for a Lipa na M-Pesa shortcode (Paybill or Till), get Daraja production keys and passkey through Safaricom Go-Live, then set MPESA_ENV=production." : undefined}
            />
            <Row name="Email" status={channelConfigured("EMAIL") ? "Connected" : "Not connected"} tone={channelConfigured("EMAIL") ? "ok" : "warn"} detail="Order, payment and password-reset emails." todo={channelConfigured("EMAIL") ? undefined : "Set SMTP_URL (any SMTP provider) or RESEND_API_KEY, and EMAIL_FROM with a verified sender domain."} />
            <Row name="SMS (Africa's Talking)" status={channelConfigured("SMS") ? "Connected" : "Not connected"} tone={channelConfigured("SMS") ? "ok" : "warn"} detail="Optional order updates by SMS." todo={channelConfigured("SMS") ? undefined : "Set AT_USERNAME, AT_API_KEY and an approved AT_SENDER_ID."} />
            <Row name="WhatsApp (Meta Cloud API)" status={channelConfigured("WHATSAPP") ? "Connected" : "Not connected"} tone={channelConfigured("WHATSAPP") ? "ok" : "warn"} detail="Optional order updates on WhatsApp." todo={channelConfigured("WHATSAPP") ? undefined : "Verify a WhatsApp Business number with Meta, get an approved message template, then set WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_TEMPLATE_NAME."} />
            <Row name="File storage" status={process.env.STORAGE_DRIVER === "s3" ? "Cloud bucket" : "Server disk"} tone={process.env.STORAGE_DRIVER === "s3" ? "ok" : "warn"} detail={process.env.STORAGE_DRIVER === "s3" ? "Images are stored in S3-compatible buckets." : "Images are stored on this server's disk. Back up the storage folder, or switch to a bucket for multi-server hosting."} />
            <Row name="Background worker" status={workerOk ? "Running" : "No recent activity"} tone={workerOk ? "ok" : "bad"} detail={lastJobAt ? `Last job finished ${fmtDate(lastJobAt, true)}.` : "No jobs have run yet."} todo={workerOk ? undefined : "Run `npm run worker` alongside the website, or schedule /api/cron/tick every minute."} />
            <Row name="Error alerts" status={process.env.ERROR_WEBHOOK_URL ? "Connected" : "Logs only"} tone={process.env.ERROR_WEBHOOK_URL ? "ok" : "warn"} detail="Server errors are written to the logs as structured JSON." todo={process.env.ERROR_WEBHOOK_URL ? undefined : "Optionally set ERROR_WEBHOOK_URL (e.g. a Slack/Discord webhook) to be alerted."} />
            <Row name="KRA eTIMS" status="Not integrated" tone="warn" detail="This system doesn't transmit invoices to KRA. Documents are payment receipts unless you confirm eTIMS reporting elsewhere (Tax settings)." />
            <Row name="Courier APIs" status="Manual" tone="warn" detail="Courier name and tracking number are entered by staff. A courier adapter can be added once you choose a courier with an API." />
          </tbody>
        </table>
      </div>
    </>
  );
}
