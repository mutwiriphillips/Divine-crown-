"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { action, optStr, str, UserError } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/server";

/** Moderation never edits what the customer wrote or their rating; it only decides whether it's shown. */
export const moderateReviewAction = action(async (fd) => {
  const user = await requirePermission("feedback.moderate");
  const id = str(fd, "id");
  const op = str(fd, "op");
  const r = await db.query.reviews.findFirst({ where: eq(schema.reviews.id, id) });
  if (!r) throw new UserError("Review not found.");
  if (op === "respond") {
    const text = str(fd, "response");
    await db.update(schema.reviews).set({ adminResponse: text || null, respondedById: user.id, respondedAt: new Date() }).where(eq(schema.reviews.id, id));
  } else {
    const status = ({ approve: "APPROVED", reject: "REJECTED", flag: "FLAGGED" } as Record<string, "APPROVED" | "REJECTED" | "FLAGGED">)[op];
    if (!status) throw new UserError("Unknown action.");
    if (status === "REJECTED" && !optStr(fd, "note")) throw new UserError("Note why it's rejected (kept for your records).");
    await db.update(schema.reviews).set({ status, moderatedById: user.id, moderatedAt: new Date(), moderationNote: optStr(fd, "note") }).where(eq(schema.reviews.id, id));
  }
  await audit({ userId: user.id, action: `review.${op}`, entityType: "review", entityId: id, details: { note: optStr(fd, "note") } });
  revalidatePath("/admin/feedback");
  return { ok: true, message: "Saved." };
});

export const answerQuestionAction = action(async (fd) => {
  const user = await requirePermission("feedback.moderate");
  const id = str(fd, "id");
  const op = str(fd, "op");
  if (op === "hide") await db.update(schema.productQuestions).set({ status: "HIDDEN" }).where(eq(schema.productQuestions.id, id));
  else {
    const answer = str(fd, "answer");
    if (answer.length < 2) throw new UserError("Write an answer.");
    await db.update(schema.productQuestions).set({ answer, answeredById: user.id, answeredAt: new Date(), status: "PUBLISHED" }).where(eq(schema.productQuestions.id, id));
  }
  await audit({ userId: user.id, action: `question.${op || "answer"}`, entityType: "question", entityId: id });
  revalidatePath("/admin/feedback");
  return { ok: true, message: op === "hide" ? "Hidden." : "Answer published." };
});
