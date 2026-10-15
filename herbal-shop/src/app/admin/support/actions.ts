"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { action, bool, optStr, str, UserError } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/server";
import { notify } from "@/lib/notifications";

export const ticketReplyAction = action(async (fd) => {
  const user = await requirePermission("support.manage");
  const id = str(fd, "ticketId");
  const body = str(fd, "body");
  if (body.length < 2) throw new UserError("Write a message.");
  const internal = bool(fd, "internal");
  const t = await db.query.supportTickets.findFirst({ where: eq(schema.supportTickets.id, id) });
  if (!t) throw new UserError("Not found.");
  await db.transaction(async (tx) => {
    const [m] = await tx.insert(schema.ticketMessages).values({ ticketId: id, authorId: user.id, internal, body: body.slice(0, 4000) }).returning();
    if (!internal) {
      await tx.update(schema.supportTickets).set({ status: t.status === "OPEN" ? "IN_PROGRESS" : t.status }).where(eq(schema.supportTickets.id, id));
      await notify(tx, { event: "ticket.update", entityType: "ticket_message", entityId: m.id, to: { customerId: t.customerId, name: t.contactName, email: t.contactEmail, phone: t.contactPhone }, vars: { ticketNumber: t.number, message: body } });
    }
  });
  revalidatePath(`/admin/support/${id}`);
  return { ok: true, message: internal ? "Note added (staff only)." : "Reply sent." };
});

export const ticketUpdateAction = action(async (fd) => {
  const user = await requirePermission("support.manage");
  const id = str(fd, "ticketId");
  const status = str(fd, "status") as (typeof schema.ticketStatus.enumValues)[number];
  if (!schema.ticketStatus.enumValues.includes(status)) throw new UserError("Choose a status.");
  const resolution = optStr(fd, "resolution");
  if ((status === "RESOLVED" || status === "CLOSED") && !resolution) throw new UserError("Record how it was resolved.");
  await db
    .update(schema.supportTickets)
    .set({ status, priority: Number(str(fd, "priority") || 2), assignedToId: optStr(fd, "assignedToId"), resolution, resolvedAt: status === "RESOLVED" || status === "CLOSED" ? new Date() : null })
    .where(eq(schema.supportTickets.id, id));
  await audit({ userId: user.id, action: "ticket.update", entityType: "ticket", entityId: id, details: { status } });
  revalidatePath(`/admin/support/${id}`);
  return { ok: true, message: "Saved." };
});
