import { and, asc, eq, isNull } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { getAllSettings } from "@/lib/settings";
import { nextNumber } from "@/lib/sequence";

export type DocSnapshot = {
  kind: "RECEIPT" | "INVOICE" | "CREDIT_NOTE";
  title: string; // "Payment receipt", "Tax invoice", "Invoice", "Credit note"
  isTaxInvoice: boolean;
  number: string;
  issuedAt: string;
  business: { name: string; address: string; phone: string; email: string; kraPin: string; town: string };
  order: { number: string; source: string; placedAt: string; cashier: string | null; fulfilment: string };
  customer: { name: string; phone: string | null; email: string | null } | null;
  lines: { name: string; variant: string; qty: number; unitCents: number; discountCents: number; totalCents: number }[];
  subtotalCents: number;
  discountCents: number;
  deliveryFeeCents: number;
  taxCents: number;
  taxRateBp: number;
  taxInclusive: boolean;
  totalCents: number;
  payments: { method: string; amountCents: number; reference: string | null; at: string }[];
  amountPaidCents: number;
  balanceCents: number;
  cashTenderedCents?: number;
  changeCents?: number;
  refund?: { number: string; reason: string; amountCents: number; method: string; status: string };
  footer: string;
  returnPolicy: string;
  note: string | null;
};

const METHOD_LABEL: Record<string, string> = {
  MPESA: "M-Pesa",
  CASH: "Cash",
  CARD: "Card",
  BANK_TRANSFER: "Bank transfer",
  CASH_ON_DELIVERY: "Cash on delivery",
  OTHER: "Other",
};
export const methodLabel = (m: string) => METHOD_LABEL[m] ?? m;

/**
 * Issue (or return the already-issued) document for an order. Documents are frozen snapshots:
 * reprinting reads the snapshot and never creates another sale or number.
 */
export async function issueDocument(
  tx: Tx,
  args: { type: "RECEIPT" | "INVOICE" | "CREDIT_NOTE"; orderId: string; refundId?: string; cashTenderedCents?: number; changeCents?: number },
) {
  const existing = await tx.query.documents.findFirst({
    where: and(
      eq(schema.documents.orderId, args.orderId),
      eq(schema.documents.type, args.type),
      args.refundId ? eq(schema.documents.refundId, args.refundId) : isNull(schema.documents.refundId),
    ),
  });
  if (existing) return existing;

  const order = await tx.query.orders.findFirst({
    where: eq(schema.orders.id, args.orderId),
    with: { items: true, payments: { orderBy: (p) => asc(p.receivedAt) } },
  });
  if (!order) throw new Error("Order not found");
  const { business, commerce } = await getAllSettings(tx);
  const cashier = order.cashierId
    ? (await tx.query.users.findFirst({ where: eq(schema.users.id, order.cashierId), columns: { name: true } }))?.name ?? null
    : null;
  const isTaxInvoice = args.type !== "CREDIT_NOTE" && commerce.vatRegistered && commerce.etimsConnected && !!business.kraPin;

  let refund: DocSnapshot["refund"];
  let lines: DocSnapshot["lines"] = order.items.map((i) => ({
    name: i.productName,
    variant: i.variantName,
    qty: i.qty,
    unitCents: i.unitPriceCents,
    discountCents: i.discountCents,
    totalCents: i.lineTotalCents,
  }));
  if (args.type === "CREDIT_NOTE") {
    if (!args.refundId) throw new Error("Credit note needs a refund");
    const r = await tx.query.refunds.findFirst({ where: eq(schema.refunds.id, args.refundId), with: { items: { with: { orderItem: true } } } });
    if (!r) throw new Error("Refund not found");
    refund = { number: r.number, reason: r.reason, amountCents: r.amountCents, method: methodLabel(r.method), status: r.status };
    lines = r.items.map((ri) => ({
      name: ri.orderItem.productName,
      variant: ri.orderItem.variantName,
      qty: ri.qty,
      unitCents: ri.orderItem.unitPriceCents,
      discountCents: 0,
      totalCents: ri.amountCents,
    }));
  }

  const number = await nextNumber(tx, args.type);
  const paid = order.payments.filter((p) => p.status === "SUCCEEDED").reduce((a, p) => a + p.amountCents, 0);
  const snapshot: DocSnapshot = {
    kind: args.type,
    title: args.type === "CREDIT_NOTE" ? "Credit note" : isTaxInvoice ? "Tax invoice" : args.type === "INVOICE" ? "Invoice" : "Payment receipt",
    isTaxInvoice,
    number,
    issuedAt: new Date().toISOString(),
    business: {
      name: business.name,
      address: business.address,
      phone: business.phone,
      email: business.email,
      kraPin: business.kraPin,
      town: business.town,
    },
    order: {
      number: order.number,
      source: order.source,
      placedAt: order.placedAt.toISOString(),
      cashier,
      fulfilment: order.fulfilmentMethod,
    },
    customer: order.contactName ? { name: order.contactName, phone: order.contactPhone, email: order.contactEmail } : null,
    lines,
    subtotalCents: args.type === "CREDIT_NOTE" ? refund!.amountCents : order.subtotalCents,
    discountCents: args.type === "CREDIT_NOTE" ? 0 : order.discountCents,
    deliveryFeeCents: args.type === "CREDIT_NOTE" ? 0 : order.deliveryFeeCents,
    taxCents: args.type === "CREDIT_NOTE" ? 0 : order.taxCents,
    taxRateBp: commerce.vatRegistered ? commerce.vatRateBp : 0,
    taxInclusive: order.taxInclusive,
    totalCents: args.type === "CREDIT_NOTE" ? refund!.amountCents : order.totalCents,
    payments: order.payments
      .filter((p) => p.status === "SUCCEEDED")
      .map((p) => ({ method: methodLabel(p.method), amountCents: p.amountCents, reference: p.reference, at: p.receivedAt.toISOString() })),
    amountPaidCents: paid,
    balanceCents: Math.max(0, order.totalCents - paid),
    cashTenderedCents: args.cashTenderedCents,
    changeCents: args.changeCents,
    refund,
    footer: commerce.receiptFooter,
    returnPolicy: commerce.returnPolicySummary,
    note: isTaxInvoice ? null : "This is a payment receipt, not a tax invoice.",
  };
  const [doc] = await tx
    .insert(schema.documents)
    .values({ type: args.type, number, orderId: order.id, refundId: args.refundId ?? null, isTaxInvoice, snapshot })
    .returning();
  return doc;
}
