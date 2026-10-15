import PDFDocument from "pdfkit";
import type { DocSnapshot } from "@/lib/documents";
import { formatKES } from "@/lib/money";

/** A4 PDF of a frozen document snapshot. Uses the built-in Helvetica font, so no font files are needed. */
export function renderDocumentPdf(s: DocSnapshot): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 48, info: { Title: `${s.title} ${s.number}`, Author: s.business.name } });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const plum = "#3A1631";
    const k = (c: number) => formatKES(c).replace("−", "-");
    const when = new Date(s.issuedAt).toLocaleString("en-KE", { timeZone: "Africa/Nairobi", dateStyle: "medium", timeStyle: "short" });

    doc.fillColor(plum).font("Helvetica-Bold").fontSize(20).text(s.business.name, 48, 48);
    doc.fillColor("#333").font("Helvetica").fontSize(9);
    for (const line of [[s.business.address, s.business.town].filter(Boolean).join(", "), [s.business.phone, s.business.email].filter(Boolean).join("  ·  "), s.business.kraPin ? `KRA PIN: ${s.business.kraPin}` : ""]) {
      if (line) doc.text(line);
    }
    doc.font("Helvetica-Bold").fontSize(14).fillColor("#000").text(s.title, 300, 48, { width: 247, align: "right" });
    doc.font("Helvetica").fontSize(9).text(`No. ${s.number}`, { width: 247, align: "right" }).text(when, { width: 247, align: "right" }).text(`Order ${s.order.number}`, { width: 247, align: "right" });

    let y = 140;
    doc.moveTo(48, y).lineTo(547, y).strokeColor("#ccc").stroke();
    y += 10;
    if (s.customer && s.customer.name !== "Walk-in customer") {
      doc.fontSize(9).text(`Customer: ${s.customer.name}${s.customer.phone ? `  ·  ${s.customer.phone}` : ""}${s.customer.email ? `  ·  ${s.customer.email}` : ""}`, 48, y);
      y += 16;
    }
    if (s.refund) {
      doc.text(`Refund ${s.refund.number}. Reason: ${s.refund.reason}`, 48, y);
      y += 16;
    }
    y += 6;
    doc.font("Helvetica-Bold").fontSize(9);
    doc.text("Item", 48, y).text("Qty", 330, y, { width: 40, align: "right" }).text("Unit", 380, y, { width: 75, align: "right" }).text("Amount", 465, y, { width: 82, align: "right" });
    y += 14;
    doc.moveTo(48, y).lineTo(547, y).stroke();
    y += 6;
    doc.font("Helvetica");
    for (const l of s.lines) {
      const name = `${l.name}${l.variant !== "Standard" ? ` (${l.variant})` : ""}${l.discountCents ? `  — discount ${k(l.discountCents)}` : ""}`;
      const h = doc.heightOfString(name, { width: 270 });
      if (y + h > 760) {
        doc.addPage();
        y = 48;
      }
      doc.text(name, 48, y, { width: 270 }).text(String(l.qty), 330, y, { width: 40, align: "right" }).text(k(l.unitCents), 380, y, { width: 75, align: "right" }).text(k(l.totalCents), 465, y, { width: 82, align: "right" });
      y += Math.max(h, 12) + 4;
    }
    y += 4;
    doc.moveTo(300, y).lineTo(547, y).stroke();
    y += 8;
    const row = (label: string, value: string, bold = false) => {
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 11 : 9).text(label, 300, y, { width: 160 }).text(value, 465, y, { width: 82, align: "right" });
      y += bold ? 16 : 13;
    };
    if (s.kind !== "CREDIT_NOTE") {
      row("Subtotal", k(s.subtotalCents));
      if (s.discountCents) row("Discount", `-${k(s.discountCents)}`);
      if (s.deliveryFeeCents) row("Delivery", k(s.deliveryFeeCents));
      if (s.taxCents && !s.taxInclusive) row(`VAT ${s.taxRateBp / 100}%`, k(s.taxCents));
    }
    row(s.kind === "CREDIT_NOTE" ? "Refund total" : "Total", k(s.totalCents), true);
    if (s.taxCents && s.taxInclusive) row(`Includes VAT ${s.taxRateBp / 100}%`, k(s.taxCents));
    if (s.kind !== "CREDIT_NOTE") {
      for (const p of s.payments) row(`Paid · ${p.method}${p.reference ? ` ${p.reference}` : ""}`, k(p.amountCents));
      if (s.cashTenderedCents) row("Cash tendered", k(s.cashTenderedCents));
      if (s.changeCents) row("Change", k(s.changeCents));
      if (s.balanceCents) row("Balance due", k(s.balanceCents), true);
    }
    y += 16;
    doc.font("Helvetica").fontSize(8.5).fillColor("#444");
    for (const t of [s.note, s.returnPolicy, s.footer]) {
      if (t) {
        doc.text(t, 48, y, { width: 499 });
        y = doc.y + 4;
      }
    }
    doc.end();
  });
}
