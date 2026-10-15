"use server";

import { revalidatePath } from "next/cache";
import { action } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/server";
import { reconcilePendingAttempts } from "@/lib/payments/mpesa";

export const reconcileNowAction = action(async () => {
  const user = await requirePermission("payments.reconcile");
  const n = await reconcilePendingAttempts(30);
  await audit({ userId: user.id, action: "payment.reconcile", details: { resolved: n } });
  revalidatePath("/admin/payments");
  return { ok: true, message: n ? `${n} payment request(s) updated from M-Pesa.` : "Checked. Nothing new from M-Pesa." };
});
