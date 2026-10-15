"use server";

import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, schema } from "@/db";
import { action, bool, int, optStr, str, UserError } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { destroyAllSessions, hashPassword, normalizeEmail, normalizePhone } from "@/lib/auth/core";
import { clientIp, requirePermission, requireUser } from "@/lib/auth/server";
import { randomToken } from "@/lib/crypto";
import { ALL_PERMISSIONS, type Permission } from "@/lib/permissions";
import { getSetting, saveSetting } from "@/lib/settings";
import { notify } from "@/lib/notifications";

export const markAlertsReadAction = action(async () => {
  await requireUser();
  await db.update(schema.notifications).set({ readAt: new Date() }).where(and(eq(schema.notifications.channel, "STAFF"), isNull(schema.notifications.readAt)));
  revalidatePath("/admin");
  return { ok: true, message: "Done." };
});

export const saveBusinessAction = action(async (fd) => {
  const user = await requirePermission("settings.business");
  const current = await getSetting("business");
  const faqs: { q: string; a: string }[] = [];
  const qs = fd.getAll("faqQ").map(String);
  const as = fd.getAll("faqA").map(String);
  qs.forEach((q, i) => {
    if (q.trim() && as[i]?.trim()) faqs.push({ q: q.trim(), a: as[i].trim() });
  });
  const wa = str(fd, "whatsapp") ? normalizePhone(str(fd, "whatsapp")) : "";
  if (str(fd, "whatsapp") && !wa) throw new UserError("Check the WhatsApp number.", { whatsapp: "Use a Kenyan mobile number." });
  const heroIds = fd.getAll("heroImage").map(String).filter((x) => /^[0-9a-f-]{36}$/.test(x));
  if (heroIds.length > 3) throw new UserError("Choose up to 3 hero photos.");
  const next = {
    ...current,
    name: str(fd, "name") || current.name,
    tagline: str(fd, "tagline"),
    logoAssetId: optStr(fd, "logoAssetId"),
    phone: str(fd, "phone"),
    whatsapp: wa ?? "",
    email: str(fd, "email"),
    address: str(fd, "address"),
    town: str(fd, "town"),
    openingHours: str(fd, "openingHours"),
    kraPin: str(fd, "kraPin").toUpperCase(),
    social: { facebook: str(fd, "facebook"), instagram: str(fd, "instagram"), tiktok: str(fd, "tiktok") },
    announcement: str(fd, "announcement"),
    hero: { headline: str(fd, "heroHeadline") || current.hero.headline, intro: str(fd, "heroIntro"), imageAssetIds: heroIds },
    about: { title: str(fd, "aboutTitle") || "About the shop", body: str(fd, "aboutBody") },
    faqs,
    policies: { returns: str(fd, "policyReturns"), delivery: str(fd, "policyDelivery"), privacy: str(fd, "policyPrivacy"), terms: str(fd, "policyTerms") },
  };
  for (const url of Object.values(next.social)) if (url && !/^https:\/\//.test(url)) throw new UserError("Social links must start with https://");
  await saveSetting("business", next, user.id);
  await audit({ userId: user.id, action: "settings.business", ip: await clientIp() });
  revalidatePath("/", "layout");
  return { ok: true, message: "Saved. The shop shows the changes straight away." };
});

export const saveCommerceAction = action(async (fd) => {
  const user = await requirePermission("settings.financial");
  const current = await getSetting("commerce");
  const vatPct = Number(str(fd, "vatRate") || "16");
  if (!Number.isFinite(vatPct) || vatPct < 0 || vatPct > 50) throw new UserError("Enter a VAT rate between 0 and 50.");
  const next = {
    ...current,
    vatRegistered: bool(fd, "vatRegistered"),
    vatRateBp: Math.round(vatPct * 100),
    pricesIncludeTax: bool(fd, "pricesIncludeTax"),
    etimsConnected: bool(fd, "etimsConnected"),
    guestCheckout: bool(fd, "guestCheckout"),
    cashOnDelivery: bool(fd, "cashOnDelivery"),
    collectionEnabled: bool(fd, "collectionEnabled"),
    collectionAddress: str(fd, "collectionAddress"),
    reservationMinutes: int(fd, "reservationMinutes", "payment window"),
    wholesaleEnabled: bool(fd, "wholesaleEnabled"),
    receiptFooter: str(fd, "receiptFooter"),
    returnPolicySummary: str(fd, "returnPolicySummary"),
    lowStockEmail: str(fd, "lowStockEmail"),
    dailySummaryEmail: str(fd, "dailySummaryEmail"),
    requireMfaForOwner: bool(fd, "requireMfaForOwner"),
    posAllowManualMpesaCode: bool(fd, "posAllowManualMpesaCode"),
    abandonedCartReminders: bool(fd, "abandonedCartReminders"),
  };
  if (next.etimsConnected && !next.vatRegistered) throw new UserError("eTIMS only applies when you're VAT registered.");
  if (next.etimsConnected) {
    // This app does not transmit invoices to KRA. Refuse to label documents as tax invoices unless the owner
    // confirms invoices are being transmitted through another approved system.
    if (fd.get("etimsConfirm") !== "on") throw new UserError("Confirm that sales are being reported to KRA eTIMS through an approved system before marking documents as tax invoices.");
  }
  await saveSetting("commerce", next, user.id);
  await audit({ userId: user.id, action: "settings.financial", details: { before: current, after: next }, ip: await clientIp() });
  revalidatePath("/", "layout");
  return { ok: true, message: "Saved." };
});

const staffSchema = z.object({ name: z.string().trim().min(2, "Enter a name."), email: z.string().trim().toLowerCase().email("Enter a valid email."), roleId: z.string().uuid() });

export const createStaffAction = action(async (fd) => {
  const user = await requirePermission("staff.manage");
  const d = staffSchema.parse({ name: str(fd, "name"), email: str(fd, "email"), roleId: str(fd, "roleId") });
  const role = await db.query.roles.findFirst({ where: eq(schema.roles.id, d.roleId) });
  if (!role?.isStaff) throw new UserError("Choose a staff role.");
  if (role.key === "OWNER" && user.roleKey !== "OWNER") throw new UserError("Only an owner can create another owner.");
  const email = normalizeEmail(d.email);
  if (await db.query.users.findFirst({ where: eq(schema.users.email, email) })) throw new UserError("Someone already uses that email.");
  const temp = randomToken(9);
  const [u] = await db.insert(schema.users).values({ name: d.name, email, phone: str(fd, "phone") ? normalizePhone(str(fd, "phone")) : null, roleId: role.id, passwordHash: await hashPassword(temp) }).returning();
  await audit({ userId: user.id, action: "staff.create", entityType: "user", entityId: u.id, details: { role: role.key }, ip: await clientIp() });
  revalidatePath("/admin/settings/staff");
  return { ok: true, message: `Account created. Give ${d.name} this temporary password privately: ${temp} — they should change it after signing in.` };
});

export const updateStaffAction = action(async (fd) => {
  const user = await requirePermission("staff.manage");
  const id = str(fd, "id");
  const target = await db.query.users.findFirst({ where: eq(schema.users.id, id), with: { role: true } });
  if (!target) throw new UserError("Not found.");
  const op = str(fd, "op");
  if (id === user.id && op !== "role") throw new UserError("You can't disable or reset your own account here. Use My account.");
  if (target.role.key === "OWNER" && user.roleKey !== "OWNER") throw new UserError("Only an owner can change an owner account.");
  if (op === "role") {
    const role = await db.query.roles.findFirst({ where: eq(schema.roles.id, str(fd, "roleId")) });
    if (!role) throw new UserError("Choose a role.");
    if (role.key === "OWNER" && user.roleKey !== "OWNER") throw new UserError("Only an owner can make someone an owner.");
    if (target.role.key === "OWNER" && role.key !== "OWNER") {
      const owners = await db.execute<{ n: number }>(sql`select count(*)::int as n from users u join roles r on r.id = u.role_id where r.key = 'OWNER' and u.status = 'ACTIVE'`);
      if (Number(owners.rows[0].n) <= 1) throw new UserError("There must always be at least one active owner.");
    }
    await db.update(schema.users).set({ roleId: role.id }).where(eq(schema.users.id, id));
    await destroyAllSessions(id);
    await audit({ userId: user.id, action: "staff.role_change", entityType: "user", entityId: id, details: { from: target.role.key, to: role.key }, ip: await clientIp() });
  } else if (op === "disable" || op === "enable") {
    await db.update(schema.users).set({ status: op === "disable" ? "DISABLED" : "ACTIVE" }).where(eq(schema.users.id, id));
    if (op === "disable") await destroyAllSessions(id);
    await audit({ userId: user.id, action: `staff.${op}`, entityType: "user", entityId: id, ip: await clientIp() });
  } else if (op === "reset") {
    const temp = randomToken(9);
    await db.update(schema.users).set({ passwordHash: await hashPassword(temp), mfaEnabled: false, mfaSecretEnc: null, failedLogins: 0, lockedUntil: null }).where(eq(schema.users.id, id));
    await destroyAllSessions(id);
    await audit({ userId: user.id, action: "staff.password_reset", entityType: "user", entityId: id, ip: await clientIp() });
    revalidatePath("/admin/settings/staff");
    return { ok: true, message: `New temporary password for ${target.name}: ${temp} (two-step sign-in was also reset).` };
  } else throw new UserError("Unknown action.");
  revalidatePath("/admin/settings/staff");
  return { ok: true, message: "Saved." };
});

export const saveRoleAction = action(async (fd) => {
  const user = await requirePermission("staff.manage");
  if (user.roleKey !== "OWNER") throw new UserError("Only the owner can change what roles may do.");
  const id = str(fd, "id");
  const role = await db.query.roles.findFirst({ where: eq(schema.roles.id, id) });
  if (!role) throw new UserError("Role not found.");
  if (role.key === "OWNER" || role.key === "CUSTOMER") throw new UserError("The owner and customer roles can't be changed.");
  const perms = fd.getAll("perm").map(String).filter((p): p is Permission => (ALL_PERMISSIONS as string[]).includes(p));
  await db.update(schema.roles).set({ permissions: perms }).where(eq(schema.roles.id, id));
  await audit({ userId: user.id, action: "role.permissions", entityType: "role", entityId: id, details: { before: role.permissions, after: perms }, ip: await clientIp() });
  revalidatePath("/admin/settings/staff");
  return { ok: true, message: `${role.name} permissions saved.` };
});

export const saveTemplateAction = action(async (fd) => {
  const user = await requirePermission("notifications.manage");
  const key = str(fd, "key");
  const channel = str(fd, "channel") as "EMAIL";
  if (!schema.notificationChannel.enumValues.includes(channel)) throw new UserError("Unknown channel.");
  const body = str(fd, "body");
  if (body.length < 5) throw new UserError("The message is too short.");
  await db
    .insert(schema.notificationTemplates)
    .values({ key, channel, subject: optStr(fd, "subject"), body, isActive: bool(fd, "isActive") })
    .onConflictDoUpdate({ target: [schema.notificationTemplates.key, schema.notificationTemplates.channel], set: { subject: optStr(fd, "subject"), body, isActive: bool(fd, "isActive"), updatedAt: new Date() } });
  await audit({ userId: user.id, action: "notification.template", details: { key, channel } });
  revalidatePath("/admin/settings/notifications");
  return { ok: true, message: "Template saved." };
});

export const resendNotificationAction = action(async (fd) => {
  await requirePermission("notifications.manage");
  const id = str(fd, "id");
  const n = await db.query.notifications.findFirst({ where: eq(schema.notifications.id, id) });
  if (!n) throw new UserError("Not found.");
  await db.transaction(async (tx) => {
    await tx.update(schema.notifications).set({ status: "QUEUED", lastError: null, skipReason: null }).where(eq(schema.notifications.id, id));
    await tx.insert(schema.jobs).values({ type: "send_notification", payload: { notificationId: id } });
  });
  revalidatePath("/admin/settings/notifications");
  return { ok: true, message: "Queued to send again." };
});

/** Fulfil a privacy deletion request: anonymise personal data, keep financial records without identity. */
export const handleDataRequestAction = action(async (fd) => {
  const user = await requirePermission("customers.export");
  const id = str(fd, "id");
  const op = str(fd, "op");
  const req = await db.query.dataRequests.findFirst({ where: eq(schema.dataRequests.id, id), with: { customer: true } });
  if (!req || req.status !== "PENDING") throw new UserError("This request has already been handled.");
  if (op === "reject") {
    const note = str(fd, "note");
    if (note.length < 5) throw new UserError("Explain why it's rejected (the customer will be told).");
    await db.update(schema.dataRequests).set({ status: "REJECTED", note, handledById: user.id, completedAt: new Date() }).where(eq(schema.dataRequests.id, id));
  } else if (op === "complete") {
    const c = req.customer;
    await db.transaction(async (tx) => {
      await notify(tx, {
        event: "ticket.update",
        entityType: "data_request",
        entityId: id,
        to: { name: c.name, email: c.email, phone: c.phone },
        vars: { ticketNumber: "privacy", message: "Your personal data has been deleted as you asked. Records of past purchases are kept without your name or contact details where the law requires." },
      });
      const placeholder = `Deleted customer ${c.id.slice(0, 8)}`;
      await tx.update(schema.customers).set({ name: placeholder, email: null, phone: null, notes: null, marketingEmail: false, marketingSms: false, marketingWhatsapp: false, anonymizedAt: new Date(), userId: null }).where(eq(schema.customers.id, c.id));
      await tx.delete(schema.addresses).where(eq(schema.addresses.customerId, c.id));
      await tx.execute(sql`update orders set contact_name = ${placeholder}, contact_phone = null, contact_email = null, delivery_address = null, notes = null, access_token_hash = null where customer_id = ${c.id}`);
      await tx.execute(sql`update support_tickets set contact_name = ${placeholder}, contact_phone = null, contact_email = null where customer_id = ${c.id}`);
      await tx.execute(sql`update reviews set display_name = 'Former customer' where customer_id = ${c.id}`);
      await tx.delete(schema.carts).where(eq(schema.carts.customerId, c.id));
      if (c.email) await tx.delete(schema.newsletterSubscribers).where(eq(schema.newsletterSubscribers.email, c.email));
      if (c.userId) {
        await tx.delete(schema.sessions).where(eq(schema.sessions.userId, c.userId));
        await tx.update(schema.users).set({ name: placeholder, email: null, phone: `deleted-${c.userId}`, passwordHash: await hashPassword(randomToken(24)), status: "DISABLED" }).where(eq(schema.users.id, c.userId));
      }
      await tx.update(schema.dataRequests).set({ status: "COMPLETED", handledById: user.id, completedAt: new Date() }).where(eq(schema.dataRequests.id, id));
    });
  } else throw new UserError("Unknown action.");
  await audit({ userId: user.id, action: `privacy.${op}`, entityType: "data_request", entityId: id, ip: await clientIp() });
  revalidatePath("/admin/settings/privacy");
  return { ok: true, message: op === "complete" ? "Personal data deleted. Financial records remain, without identity." : "Request rejected." };
});

