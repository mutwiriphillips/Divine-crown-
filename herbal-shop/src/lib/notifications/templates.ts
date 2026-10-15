/**
 * Default notification wording. The owner can override any of these in Admin → Settings → Notifications;
 * overrides are stored in `notification_templates`. Placeholders use {{name}} syntax.
 */
export type TemplateDef = { subject?: string; body: string };

export const DEFAULT_TEMPLATES: Record<string, Partial<Record<"EMAIL" | "WHATSAPP" | "SMS" | "STAFF", TemplateDef>>> = {
  "order.placed": {
    EMAIL: {
      subject: "We've received your order {{orderNumber}}",
      body: "Hello {{name}},\n\nThanks for your order {{orderNumber}} with {{shopName}}. Total: {{total}}.\n{{paymentLine}}\n\nView your order: {{orderUrl}}\n\n{{shopName}}",
    },
    WHATSAPP: { body: "{{shopName}}: we've received order {{orderNumber}} ({{total}}). {{paymentLine}} Track it: {{orderUrl}}" },
    SMS: { body: "{{shopName}}: order {{orderNumber}} received ({{total}}). {{orderUrl}}" },
  },
  "payment.received": {
    EMAIL: {
      subject: "Payment received for {{orderNumber}}",
      body: "Hello {{name}},\n\nWe've received {{amount}} for order {{orderNumber}} (ref {{reference}}). Your receipt: {{receiptUrl}}\n\n{{shopName}}",
    },
    WHATSAPP: { body: "{{shopName}}: payment of {{amount}} received for order {{orderNumber}} (ref {{reference}}). Receipt: {{receiptUrl}}" },
    SMS: { body: "{{shopName}}: {{amount}} received for {{orderNumber}}. Ref {{reference}}." },
  },
  "payment.failed": {
    EMAIL: {
      subject: "Payment for {{orderNumber}} didn't go through",
      body: "Hello {{name}},\n\nThe M-Pesa payment for order {{orderNumber}} didn't complete ({{reason}}). You can try again here: {{orderUrl}}\n\n{{shopName}}",
    },
    WHATSAPP: { body: "{{shopName}}: the M-Pesa payment for {{orderNumber}} didn't complete ({{reason}}). Try again: {{orderUrl}}" },
  },
  "order.status": {
    EMAIL: { subject: "Order {{orderNumber}}: {{statusLabel}}", body: "Hello {{name}},\n\nYour order {{orderNumber}} is now: {{statusLabel}}.\n{{extra}}\n\n{{orderUrl}}\n\n{{shopName}}" },
    WHATSAPP: { body: "{{shopName}}: order {{orderNumber}} is now {{statusLabel}}. {{extra}} {{orderUrl}}" },
    SMS: { body: "{{shopName}}: order {{orderNumber}} is {{statusLabel}}. {{extra}}" },
  },
  "order.cancelled": {
    EMAIL: { subject: "Order {{orderNumber}} cancelled", body: "Hello {{name}},\n\nOrder {{orderNumber}} has been cancelled. {{reason}}\n\n{{shopName}}" },
    WHATSAPP: { body: "{{shopName}}: order {{orderNumber}} has been cancelled. {{reason}}" },
  },
  "refund.issued": {
    EMAIL: { subject: "Refund for {{orderNumber}}", body: "Hello {{name}},\n\nWe've issued a refund of {{amount}} for order {{orderNumber}} ({{refundNumber}}). {{payoutLine}}\n\n{{shopName}}" },
    WHATSAPP: { body: "{{shopName}}: refund of {{amount}} for order {{orderNumber}} ({{refundNumber}}). {{payoutLine}}" },
  },
  "auth.password_reset": {
    EMAIL: { subject: "Reset your password", body: "Use this link within 1 hour to set a new password: {{resetUrl}}\n\nIf you didn't ask for this, ignore this message." },
    SMS: { body: "{{shopName}} password reset link (valid 1 hour): {{resetUrl}}" },
  },
  "order.access_link": {
    EMAIL: { subject: "Your order link for {{orderNumber}}", body: "Here's a private link to view order {{orderNumber}}: {{orderUrl}}" },
    SMS: { body: "{{shopName}}: view order {{orderNumber}} here: {{orderUrl}}" },
  },
  "ticket.update": {
    EMAIL: { subject: "Update on your request {{ticketNumber}}", body: "Hello {{name}},\n\n{{message}}\n\n{{shopName}}" },
  },
  "cart.reminder": {
    EMAIL: {
      subject: "You left something in your cart",
      body: "Hello {{name}},\n\nYour cart at {{shopName}} is saved: {{cartUrl}}\n\nTo stop these reminders, update your preferences: {{prefsUrl}}",
    },
  },
  "staff.new_order": { STAFF: { body: "New order {{orderNumber}} ({{total}}) from {{name}}." } },
  "staff.low_stock": { STAFF: { body: "{{count}} product(s) at or below reorder level: {{list}}" }, EMAIL: { subject: "Low stock: {{count}} product(s)", body: "{{list}}" } },
  "staff.feedback": { STAFF: { body: "New {{kind}} awaiting moderation: {{summary}}" } },
  "staff.ticket": { STAFF: { body: "New support request {{ticketNumber}}: {{subject}}" } },
  "staff.payment_review": { STAFF: { body: "Order {{orderNumber}} needs review: {{reason}}" } },
  "staff.daily_summary": {
    STAFF: { body: "{{date}}: {{orders}} orders, gross sales {{gross}}, refunds {{refunds}}." },
    EMAIL: { subject: "Daily sales summary {{date}}", body: "{{body}}" },
  },
  "staff.po_update": { STAFF: { body: "Purchase order {{poNumber}}: {{message}}" } },
};

export function renderTemplate(text: string, vars: Record<string, string | number | null | undefined>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    const v = vars[k];
    return v === null || v === undefined ? "" : String(v);
  });
}
