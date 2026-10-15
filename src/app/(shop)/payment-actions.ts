"use server";

import { action, str, UserError } from "@/lib/actions";
import { normalizePhone } from "@/lib/auth/core";
import { clientIp } from "@/lib/auth/server";
import { canAccessOrder, findOrderByNumber } from "@/lib/order-access";
import { initiateStkPush } from "@/lib/payments/mpesa";
import { rateLimit } from "@/lib/ratelimit";

export const payWithMpesaAction = action(async (fd) => {
  const order = await findOrderByNumber(str(fd, "number"));
  if (!order || !(await canAccessOrder(order, str(fd, "key") || null))) throw new UserError("Order not found.");
  if (!(await rateLimit(`stk:${order.id}`, 6, 900)) || !(await rateLimit(`stk-ip:${(await clientIp()) ?? "x"}`, 20, 900))) {
    throw new UserError("Too many payment requests. Wait a few minutes, or contact the shop.");
  }
  const phone = normalizePhone(str(fd, "phone"));
  if (!phone) throw new UserError("Enter an M-Pesa number like 0712 345 678.");
  const r = await initiateStkPush(order.id, phone);
  return { ok: true, message: "Check your phone and enter your M-Pesa PIN.", data: { attemptId: r.attemptId, simulator: r.simulator } };
});
