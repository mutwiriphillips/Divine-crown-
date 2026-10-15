import nodemailer, { type Transporter } from "nodemailer";

/**
 * Delivery adapters. Each returns { status: "SENT" } on confirmed hand-off to the provider,
 * or { status: "SKIPPED", reason } when the channel isn't configured. Thrown errors are retried by the worker.
 *
 *  EMAIL     SMTP_URL (any SMTP provider)            or RESEND_API_KEY
 *  SMS       AT_API_KEY + AT_USERNAME (Africa's Talking)
 *  WHATSAPP  WHATSAPP_TOKEN + WHATSAPP_PHONE_NUMBER_ID (Meta WhatsApp Cloud API)
 *
 * Nothing is reported as sent unless the provider accepted it.
 */

export type DeliveryResult = { status: "SENT"; providerId?: string } | { status: "SKIPPED"; reason: string };

export function channelConfigured(channel: string): boolean {
  switch (channel) {
    case "EMAIL":
      return !!(process.env.SMTP_URL || process.env.RESEND_API_KEY);
    case "SMS":
      return !!(process.env.AT_API_KEY && process.env.AT_USERNAME);
    case "WHATSAPP":
      return !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
    default:
      return false;
  }
}

let transporter: Transporter | null = null;

export async function deliver(n: { channel: string; recipient: string; subject: string | null; body: string }): Promise<DeliveryResult> {
  if (!channelConfigured(n.channel)) {
    if (process.env.NODE_ENV !== "production") {
      console.info(`[notification:${n.channel} not configured] to=${n.recipient} subject=${n.subject ?? ""}\n${n.body}`);
    }
    return { status: "SKIPPED", reason: `${n.channel} provider is not configured` };
  }
  const from = process.env.EMAIL_FROM ?? "no-reply@example.com";
  if (n.channel === "EMAIL") {
    if (process.env.RESEND_API_KEY) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [n.recipient], subject: n.subject ?? "", text: n.body }),
      });
      if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const j = (await res.json()) as { id?: string };
      return { status: "SENT", providerId: j.id };
    }
    transporter ??= nodemailer.createTransport(process.env.SMTP_URL!);
    const info = await transporter.sendMail({ from, to: n.recipient, subject: n.subject ?? "", text: n.body });
    return { status: "SENT", providerId: info.messageId };
  }
  if (n.channel === "SMS") {
    const base = process.env.AT_USERNAME === "sandbox" ? "https://api.sandbox.africastalking.com" : "https://api.africastalking.com";
    const params = new URLSearchParams({ username: process.env.AT_USERNAME!, to: `+${n.recipient.replace(/^\+/, "")}`, message: n.body });
    if (process.env.AT_SENDER_ID) params.set("from", process.env.AT_SENDER_ID);
    const res = await fetch(`${base}/version1/messaging`, {
      method: "POST",
      headers: { apiKey: process.env.AT_API_KEY!, Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });
    if (!res.ok) throw new Error(`Africa's Talking ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const j = (await res.json()) as { SMSMessageData?: { Recipients?: { status: string; messageId: string }[] } };
    const r = j.SMSMessageData?.Recipients?.[0];
    if (!r || !/success/i.test(r.status)) throw new Error(`SMS rejected: ${r?.status ?? "no recipient result"}`);
    return { status: "SENT", providerId: r.messageId };
  }
  if (n.channel === "WHATSAPP") {
    // Note: WhatsApp only allows free-form text inside a 24-hour customer-service window.
    // Business-initiated messages need an approved template; set WHATSAPP_TEMPLATE_NAME to use one
    // whose single body parameter receives the rendered message.
    const tplName = process.env.WHATSAPP_TEMPLATE_NAME;
    const payload = tplName
      ? {
          messaging_product: "whatsapp",
          to: n.recipient,
          type: "template",
          template: {
            name: tplName,
            language: { code: process.env.WHATSAPP_TEMPLATE_LANG ?? "en" },
            components: [{ type: "body", parameters: [{ type: "text", text: n.body.slice(0, 1000) }] }],
          },
        }
      : { messaging_product: "whatsapp", to: n.recipient, type: "text", text: { body: n.body } };
    const res = await fetch(`https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`WhatsApp ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const j = (await res.json()) as { messages?: { id: string }[] };
    return { status: "SENT", providerId: j.messages?.[0]?.id };
  }
  return { status: "SKIPPED", reason: `Unsupported channel ${n.channel}` };
}
