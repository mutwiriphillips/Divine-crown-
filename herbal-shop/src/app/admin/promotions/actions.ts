"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { action, bool, dateField, moneyField, optInt, optStr, str, UserError } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/server";

export const promotionAction = action(async (fd) => {
  const user = await requirePermission("promotions.manage");
  const id = optStr(fd, "id");
  if (str(fd, "op") === "toggle" && id) {
    const p = await db.query.promotions.findFirst({ where: eq(schema.promotions.id, id) });
    await db.update(schema.promotions).set({ isActive: !p?.isActive }).where(eq(schema.promotions.id, id));
    revalidatePath("/admin/promotions");
    return { ok: true, message: p?.isActive ? "Paused." : "Switched on." };
  }
  const name = str(fd, "name");
  if (name.length < 3) throw new UserError("Name the promotion.");
  const type = str(fd, "type") as "PERCENT" | "FIXED" | "FREE_DELIVERY";
  if (!["PERCENT", "FIXED", "FREE_DELIVERY"].includes(type)) throw new UserError("Choose a discount type.");
  const scope = str(fd, "scope") as "ORDER" | "PRODUCTS" | "CATEGORIES";
  let value = 0;
  if (type === "PERCENT") {
    value = Number(str(fd, "value"));
    if (!Number.isInteger(value) || value < 1 || value > 90) throw new UserError("Percentage must be a whole number from 1 to 90.");
  } else if (type === "FIXED") {
    value = moneyField(fd, "value", "discount amount", { required: true, wholeShillings: true })!;
    if (value <= 0) throw new UserError("Enter the amount off.");
  }
  const code = optStr(fd, "code")?.toUpperCase().replace(/\s+/g, "") ?? null;
  if (code && !/^[A-Z0-9-]{3,20}$/.test(code)) throw new UserError("Codes use 3–20 letters, numbers or dashes.");
  const productIds = fd.getAll("productIds").map(String).filter(Boolean);
  const categoryIds = fd.getAll("categoryIds").map(String).filter(Boolean);
  if (scope === "PRODUCTS" && !productIds.length) throw new UserError("Choose the products this applies to.");
  if (scope === "CATEGORIES" && !categoryIds.length) throw new UserError("Choose the categories this applies to.");
  const startsAt = dateField(fd, "startsAt");
  const endsAt = dateField(fd, "endsAt");
  if (startsAt && endsAt && endsAt <= startsAt) throw new UserError("The end date must be after the start.");
  const values = {
    name,
    code,
    type,
    value,
    scope: type === "FREE_DELIVERY" ? ("ORDER" as const) : scope,
    productIds: scope === "PRODUCTS" ? productIds : [],
    categoryIds: scope === "CATEGORIES" ? categoryIds : [],
    minOrderCents: moneyField(fd, "minOrder", "minimum order"),
    startsAt,
    endsAt: endsAt ? new Date(endsAt.getTime() + 86400_000 - 1000) : null,
    usageLimit: optInt(fd, "usageLimit", "usage limit"),
    perCustomerLimit: optInt(fd, "perCustomerLimit", "per-customer limit"),
    stackable: bool(fd, "stackable"),
  };
  if (id) await db.update(schema.promotions).set(values).where(eq(schema.promotions.id, id));
  else await db.insert(schema.promotions).values(values);
  await audit({ userId: user.id, action: "promotion.save", details: { name, code, type, value } });
  revalidatePath("/admin/promotions");
  return { ok: true, message: "Promotion saved." };
});

export const bannerAction = action(async (fd) => {
  const user = await requirePermission("promotions.manage");
  const id = optStr(fd, "id");
  if (str(fd, "op") === "delete" && id) {
    await db.update(schema.banners).set({ isActive: false }).where(eq(schema.banners.id, id));
    revalidatePath("/admin/promotions");
    return { ok: true, message: "Banner hidden." };
  }
  const title = str(fd, "title");
  if (title.length < 3) throw new UserError("Give the banner a title.");
  const linkUrl = optStr(fd, "linkUrl");
  if (linkUrl && !linkUrl.startsWith("/") && !linkUrl.startsWith("https://")) throw new UserError("Links must start with / (a page in the shop) or https://");
  const values = { title, body: optStr(fd, "body"), linkUrl, linkLabel: optStr(fd, "linkLabel"), startsAt: dateField(fd, "startsAt"), endsAt: dateField(fd, "endsAt"), isActive: true };
  if (id) await db.update(schema.banners).set(values).where(eq(schema.banners.id, id));
  else await db.insert(schema.banners).values(values);
  await audit({ userId: user.id, action: "banner.save", details: { title } });
  revalidatePath("/admin/promotions");
  revalidatePath("/");
  return { ok: true, message: "Banner saved." };
});
