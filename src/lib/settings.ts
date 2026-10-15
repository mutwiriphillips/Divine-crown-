import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema, type Executor } from "@/db";

/**
 * Business settings live in the `settings` table as JSON, validated by these schemas.
 * Secrets (API keys, passkeys) never live here — they are environment variables.
 */

const faq = z.object({ q: z.string(), a: z.string() });

export const businessSettingsSchema = z.object({
  name: z.string().min(1).default("Divine Crown Organics"),
  tagline: z.string().default(""),
  logoAssetId: z.string().uuid().nullable().default(null),
  phone: z.string().default("0114 202 598"),
  whatsapp: z.string().default("254114202598"), // international format without +, e.g. 2547XXXXXXXX
  email: z.string().default("muniraafandi@gmail.com"),
  address: z.string().default(""),
  town: z.string().default(""),
  openingHours: z.string().default(""),
  kraPin: z.string().default(""),
  social: z
    .object({ facebook: z.string().default(""), instagram: z.string().default(""), tiktok: z.string().default("") })
    .default({}),
  announcement: z.string().default(""),
  hero: z
    .object({
      headline: z.string().default("Traditional oils, soaps and powders, packed with care."),
      intro: z.string().default("Shop the products our customers come back for, and pay with M-Pesa on delivery or collection."),
      imageAssetIds: z.array(z.string().uuid()).default([]),
    })
    .default({}),
  about: z
    .object({
      title: z.string().default("About the shop"),
      body: z.string().default(""),
    })
    .default({}),
  faqs: z.array(faq).default([]),
  policies: z
    .object({
      returns: z.string().default(""),
      delivery: z.string().default(""),
      privacy: z.string().default(""),
      terms: z.string().default(""),
    })
    .default({}),
});

export const commerceSettingsSchema = z.object({
  /** VAT registration controls whether any tax is charged and whether invoices can be tax invoices. */
  vatRegistered: z.boolean().default(false),
  /** Rate in basis points (1600 = 16%). */
  vatRateBp: z.number().int().min(0).max(10000).default(1600),
  pricesIncludeTax: z.boolean().default(true),
  /** Tax invoices require eTIMS integration; until it is connected, documents are payment receipts only. */
  etimsConnected: z.boolean().default(false),
  guestCheckout: z.boolean().default(true),
  cashOnDelivery: z.boolean().default(false),
  collectionEnabled: z.boolean().default(true),
  collectionAddress: z.string().default(""),
  /** Minutes an unpaid online order holds stock before it is released. */
  reservationMinutes: z.number().int().min(5).max(24 * 60).default(30),
  wholesaleEnabled: z.boolean().default(false),
  receiptFooter: z.string().default("Thank you for shopping with us."),
  returnPolicySummary: z.string().default(""),
  lowStockEmail: z.string().default(""),
  dailySummaryEmail: z.string().default(""),
  requireMfaForOwner: z.boolean().default(false),
  posAllowManualMpesaCode: z.boolean().default(true),
  abandonedCartReminders: z.boolean().default(false),
});

export type BusinessSettings = z.infer<typeof businessSettingsSchema>;
export type CommerceSettings = z.infer<typeof commerceSettingsSchema>;

const registry = {
  business: businessSettingsSchema,
  commerce: commerceSettingsSchema,
} as const;
type Key = keyof typeof registry;
type ValueOf<K extends Key> = z.infer<(typeof registry)[K]>;

export async function getSetting<K extends Key>(key: K, exec: Executor = db): Promise<ValueOf<K>> {
  const row = await exec.query.settings.findFirst({ where: eq(schema.settings.key, key) });
  const parsed = registry[key].safeParse(row?.value ?? {});
  // Fall back to defaults if stored JSON is somehow invalid, rather than taking the shop down.
  return (parsed.success ? parsed.data : registry[key].parse({})) as ValueOf<K>;
}

export async function saveSetting<K extends Key>(key: K, value: unknown, userId: string | null, exec: Executor = db) {
  const parsed = registry[key].parse(value) as ValueOf<K>;
  await exec
    .insert(schema.settings)
    .values({ key, value: parsed, updatedById: userId })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value: parsed, updatedById: userId, updatedAt: new Date() } });
  return parsed;
}

export async function getAllSettings(exec: Executor = db) {
  const [business, commerce] = await Promise.all([getSetting("business", exec), getSetting("commerce", exec)]);
  return { business, commerce };
}
