"use server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { action, str } from "@/lib/actions";

export const unsubscribeAction = action(async (fd) => {
  const token = str(fd, "token");
  const r = /^[\w-]{10,64}$/.test(token) ? await db.update(schema.newsletterSubscribers).set({ unsubscribedAt: new Date() }).where(eq(schema.newsletterSubscribers.unsubscribeToken, token)).returning() : [];
  return r.length
    ? { ok: true, message: "You're unsubscribed. Order updates still reach you as normal." }
    : { ok: false, message: "This link isn't valid. Contact the shop and we'll remove you." };
});
