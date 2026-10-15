"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { action, int, moneyField, optStr, str, UserError } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { clientIp, requirePermission } from "@/lib/auth/server";
import { manualAdjustment, receiveIntoStock, transferStock } from "@/lib/inventory";

const KINDS = ["COUNT_CORRECTION", "DAMAGE", "EXPIRY", "WRITE_OFF_QUARANTINE", "RELEASE_QUARANTINE", "SUPPLIER_RETURN", "INITIAL"] as const;

export const adjustStockAction = action(async (fd) => {
  const user = await requirePermission("inventory.adjust");
  const kind = str(fd, "kind") as (typeof KINDS)[number];
  if (!KINDS.includes(kind)) throw new UserError("Choose what kind of change this is.");
  const variantId = str(fd, "variantId");
  const locationId = str(fd, "locationId");
  const v = await db.query.productVariants.findFirst({ where: eq(schema.productVariants.id, variantId) });
  if (!v) throw new UserError("Choose a product.");
  if (v.isBundle) throw new UserError("Bundles don't hold stock; adjust the items inside them.");
  const reason = str(fd, "reason");
  let qty = int(fd, "qty", "quantity");
  if (kind === "COUNT_CORRECTION") {
    // Staff enter what they counted; we work out the difference.
    const bal = await db.query.inventoryBalances.findFirst({ where: (b, { and, eq }) => and(eq(b.variantId, variantId), eq(b.locationId, locationId)) });
    if (qty < 0) throw new UserError("Enter the number of units you counted (0 or more).");
    const delta = qty - (bal?.onHand ?? 0);
    if (delta === 0) return { ok: true, message: "The count matches the system. Nothing to change." };
    qty = delta;
  }
  const batchNo = optStr(fd, "batchNo");
  const expiresAt = str(fd, "expiresAt") ? new Date(`${str(fd, "expiresAt")}T00:00:00+03:00`) : null;
  const unitCost = moneyField(fd, "unitCost", "unit cost");
  await db.transaction(async (tx) => {
    if (kind === "INITIAL") {
      if (qty <= 0) throw new UserError("Opening stock must be more than zero.");
      if (reason.length < 3) throw new UserError("Give a reason, e.g. 'Opening stock count'.");
      await receiveIntoStock(tx, { variantId, locationId, qty, unitCostCents: unitCost, type: "INITIAL", reason, refType: "MANUAL", refId: "opening", userId: user.id, batchNo, expiresAt });
    } else {
      await manualAdjustment(tx, { variantId, locationId, kind, qty, reason, userId: user.id });
    }
    await audit({ userId: user.id, action: "stock.adjust", entityType: "variant", entityId: variantId, details: { kind, qty, reason, locationId, batchNo }, ip: await clientIp() }, tx);
  });
  revalidatePath("/admin/inventory");
  return { ok: true, message: kind === "COUNT_CORRECTION" ? `Stock corrected by ${qty > 0 ? "+" : ""}${qty}.` : "Stock updated." };
});

export const transferAction = action(async (fd) => {
  const user = await requirePermission("inventory.adjust");
  const args = { variantId: str(fd, "variantId"), fromLocationId: str(fd, "fromLocationId"), toLocationId: str(fd, "toLocationId"), qty: int(fd, "qty", "quantity"), reason: str(fd, "reason") || "Stock transfer", userId: user.id };
  await db.transaction(async (tx) => {
    await transferStock(tx, args);
    await audit({ userId: user.id, action: "stock.transfer", entityType: "variant", entityId: args.variantId, details: args }, tx);
  });
  revalidatePath("/admin/inventory");
  return { ok: true, message: "Transfer recorded." };
});

export const locationAction = action(async (fd) => {
  const user = await requirePermission("settings.business");
  const name = str(fd, "name");
  const code = str(fd, "code").toUpperCase().replace(/[^A-Z0-9-]/g, "");
  if (name.length < 2 || code.length < 2) throw new UserError("Enter a name and a short code.");
  const type = str(fd, "type") === "WAREHOUSE" ? "WAREHOUSE" : "STORE";
  const id = optStr(fd, "id");
  await db.transaction(async (tx) => {
    if (str(fd, "isDefault") === "on") await tx.update(schema.locations).set({ isDefault: false });
    const values = { name, code, type: type as "STORE", isDefault: str(fd, "isDefault") === "on" };
    if (id) await tx.update(schema.locations).set(values).where(eq(schema.locations.id, id));
    else await tx.insert(schema.locations).values(values);
  });
  await audit({ userId: user.id, action: "location.save", details: { name, code } });
  revalidatePath("/admin/inventory/locations");
  return { ok: true, message: "Location saved." };
});
