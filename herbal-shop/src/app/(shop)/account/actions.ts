"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, schema } from "@/db";
import { action, bool, str, UserError } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { destroyAllSessions, hashPassword, normalizeEmail, normalizePhone, validatePasswordStrength, verifyPassword } from "@/lib/auth/core";
import { clientIp, requireUser } from "@/lib/auth/server";
import { currentCustomerId } from "@/lib/cart";
import { notifyStaff } from "@/lib/notifications";

async function me() {
  const u = await requireUser();
  const cid = await currentCustomerId();
  if (!cid) throw new UserError("Account not found.");
  return { u, cid };
}

const addressSchema = z.object({
  label: z.string().trim().max(40),
  recipient: z.string().trim().min(2, "Enter the recipient's name.").max(100),
  phone: z.string().trim(),
  county: z.string().trim().min(2, "Enter the county.").max(60),
  town: z.string().trim().min(2, "Enter the town.").max(80),
  area: z.string().trim().max(120),
  street: z.string().trim().max(160),
  landmark: z.string().trim().max(200),
});

export const saveAddressAction = action(async (fd) => {
  const { cid } = await me();
  const d = addressSchema.parse(Object.fromEntries(["label", "recipient", "phone", "county", "town", "area", "street", "landmark"].map((k) => [k, str(fd, k)])));
  const phone = normalizePhone(d.phone);
  if (!phone) throw new UserError("Check the phone number.", { phone: "Use a number like 0712 345 678." });
  const id = str(fd, "id");
  const isDefault = bool(fd, "isDefault");
  await db.transaction(async (tx) => {
    if (isDefault) await tx.update(schema.addresses).set({ isDefault: false }).where(eq(schema.addresses.customerId, cid));
    const values = { ...d, phone, isDefault, label: d.label || null, area: d.area || null, street: d.street || null, landmark: d.landmark || null };
    if (id) {
      const res = await tx.update(schema.addresses).set(values).where(and(eq(schema.addresses.id, id), eq(schema.addresses.customerId, cid))).returning();
      if (!res.length) throw new UserError("Address not found.");
    } else {
      const count = await tx.select().from(schema.addresses).where(eq(schema.addresses.customerId, cid));
      await tx.insert(schema.addresses).values({ ...values, customerId: cid, isDefault: isDefault || count.length === 0 });
    }
  });
  revalidatePath("/account/addresses");
  return { ok: true, message: "Address saved." };
});

export const deleteAddressAction = action(async (fd) => {
  const { cid } = await me();
  await db.delete(schema.addresses).where(and(eq(schema.addresses.id, str(fd, "id")), eq(schema.addresses.customerId, cid)));
  revalidatePath("/account/addresses");
  return { ok: true, message: "Address removed." };
});

export const updateProfileAction = action(async (fd) => {
  const { u, cid } = await me();
  const name = str(fd, "name");
  if (name.length < 2) throw new UserError("Enter your name.", { name: "Required." });
  const email = str(fd, "email") ? normalizeEmail(str(fd, "email")) : null;
  if (email && !z.string().email().safeParse(email).success) throw new UserError("Enter a valid email.", { email: "Invalid email." });
  const phone = str(fd, "phone") ? normalizePhone(str(fd, "phone")) : null;
  if (str(fd, "phone") && !phone) throw new UserError("Check the phone number.", { phone: "Use a number like 0712 345 678." });
  if (!email && !phone) throw new UserError("Keep at least an email or a phone number on your account.");
  const clash = await db.query.users.findFirst({ where: (x, { or, eq, and, ne }) => and(ne(x.id, u.id), or(email ? eq(x.email, email) : undefined, phone ? eq(x.phone, phone) : undefined)) });
  if (clash) throw new UserError("That email or phone is already used by another account.");
  await db.transaction(async (tx) => {
    await tx.update(schema.users).set({ name, email, phone }).where(eq(schema.users.id, u.id));
    await tx.update(schema.customers).set({ name, email, phone }).where(eq(schema.customers.id, cid));
  });
  revalidatePath("/account/profile");
  return { ok: true, message: "Details saved." };
});

export const updatePreferencesAction = action(async (fd) => {
  const { u, cid } = await me();
  const prefs = { marketingEmail: bool(fd, "marketingEmail"), marketingSms: bool(fd, "marketingSms"), marketingWhatsapp: bool(fd, "marketingWhatsapp") };
  await db.update(schema.customers).set({ ...prefs, consentUpdatedAt: new Date() }).where(eq(schema.customers.id, cid));
  await audit({ userId: u.id, action: "customer.consent", entityType: "customer", entityId: cid, details: prefs });
  revalidatePath("/account/profile");
  return { ok: true, message: "Preferences saved." };
});

export const customerPasswordAction = action(async (fd) => {
  const u = await requireUser();
  const user = await db.query.users.findFirst({ where: eq(schema.users.id, u.id) });
  if (!user || !(await verifyPassword(String(fd.get("current") ?? ""), user.passwordHash))) throw new UserError("Your current password isn't right.");
  const pw = String(fd.get("password") ?? "");
  const err = validatePasswordStrength(pw);
  if (err) throw new UserError(err);
  await db.update(schema.users).set({ passwordHash: await hashPassword(pw), passwordChangedAt: new Date() }).where(eq(schema.users.id, u.id));
  await destroyAllSessions(u.id, u.sessionId);
  await audit({ userId: u.id, action: "auth.password_change", entityType: "user", entityId: u.id, ip: await clientIp() });
  return { ok: true, message: "Password changed. Other devices have been signed out." };
});

export const deletionRequestAction = action(async (fd) => {
  const { u, cid } = await me();
  if (str(fd, "confirm") !== "DELETE") throw new UserError('Type DELETE to confirm.');
  const pending = await db.query.dataRequests.findFirst({ where: and(eq(schema.dataRequests.customerId, cid), eq(schema.dataRequests.type, "DELETE"), eq(schema.dataRequests.status, "PENDING")) });
  if (pending) return { ok: true, message: "Your deletion request is already with us." };
  await db.transaction(async (tx) => {
    const [r] = await tx.insert(schema.dataRequests).values({ customerId: cid, type: "DELETE", note: str(fd, "note").slice(0, 500) || null }).returning();
    await notifyStaff(tx, { event: "staff.ticket", entityType: "data_request", entityId: r.id, dedupeKey: `datareq:${r.id}`, vars: { ticketNumber: "Privacy", subject: `Account deletion requested by ${u.name}` } });
  });
  await audit({ userId: u.id, action: "privacy.delete_requested", entityType: "customer", entityId: cid });
  return { ok: true, message: "Request received. We'll delete or anonymise your personal data, keeping only what the law requires for financial records, and confirm by email or SMS." };
});

export const customerReplyTicketAction = action(async (fd) => {
  const { cid } = await me();
  const ticketId = str(fd, "ticketId");
  const body = str(fd, "body");
  if (body.length < 2) throw new UserError("Write a message.");
  const t = await db.query.supportTickets.findFirst({ where: and(eq(schema.supportTickets.id, ticketId), eq(schema.supportTickets.customerId, cid)) });
  if (!t) throw new UserError("Request not found.");
  await db.transaction(async (tx) => {
    await tx.insert(schema.ticketMessages).values({ ticketId, fromCustomer: true, body: body.slice(0, 4000) });
    await tx.update(schema.supportTickets).set({ status: t.status === "RESOLVED" || t.status === "CLOSED" ? "OPEN" : t.status }).where(eq(schema.supportTickets.id, ticketId));
    await notifyStaff(tx, { event: "staff.ticket", entityType: "ticket", entityId: ticketId, dedupeKey: `ticket_reply:${ticketId}:${Date.now()}`, vars: { ticketNumber: t.number, subject: `Customer replied: ${t.subject}` } });
  });
  revalidatePath("/account/support");
  return { ok: true, message: "Sent." };
});

export const rateSupportAction = action(async (fd) => {
  const { cid } = await me();
  const n = Number(str(fd, "satisfaction"));
  if (!Number.isInteger(n) || n < 1 || n > 5) throw new UserError("Choose 1 to 5.");
  await db.update(schema.supportTickets).set({ satisfaction: n }).where(and(eq(schema.supportTickets.id, str(fd, "ticketId")), eq(schema.supportTickets.customerId, cid)));
  revalidatePath("/account/support");
  return { ok: true, message: "Thanks for rating our help." };
});
