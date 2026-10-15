"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { action, bool, optStr, str, UserError } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/server";

export const updateCustomerAction = action(async (fd) => {
  const user = await requirePermission("customers.edit");
  const id = str(fd, "id");
  const name = str(fd, "name");
  if (name.length < 2) throw new UserError("Enter a name.");
  await db.update(schema.customers).set({ name, notes: optStr(fd, "notes"), isWholesale: bool(fd, "isWholesale") }).where(eq(schema.customers.id, id));
  await audit({ userId: user.id, action: "customer.update", entityType: "customer", entityId: id, details: { isWholesale: bool(fd, "isWholesale") } });
  revalidatePath(`/admin/customers/${id}`);
  return { ok: true, message: "Saved." };
});
