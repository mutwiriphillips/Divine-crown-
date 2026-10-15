"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { action, int, moneyField, optStr, str, UserError } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/server";

export const zoneAction = action(async (fd) => {
  const user = await requirePermission("delivery.manage");
  const id = optStr(fd, "id");
  const name = str(fd, "name");
  if (name.length < 2) throw new UserError("Name the delivery area.");
  const method = str(fd, "method") === "COURIER" ? "COURIER" : "LOCAL_DELIVERY";
  const values = {
    name,
    method: method as "COURIER",
    description: optStr(fd, "description"),
    feeCents: moneyField(fd, "fee", "delivery fee", { required: true, wholeShillings: true })!,
    freeOverCents: moneyField(fd, "freeOver", "free-delivery threshold", { wholeShillings: true }),
    etaText: optStr(fd, "etaText"),
    isActive: str(fd, "isActive") !== "off",
    sortOrder: int(fd, "sortOrder", "order"),
  };
  if (id) await db.update(schema.deliveryZones).set(values).where(eq(schema.deliveryZones.id, id));
  else await db.insert(schema.deliveryZones).values(values);
  await audit({ userId: user.id, action: "delivery.zone", details: values });
  revalidatePath("/admin/delivery");
  return { ok: true, message: "Delivery area saved." };
});
