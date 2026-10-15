/**
 * SAMPLE DATA for development and demos. Everything created here is flagged is_demo and named
 * "Sample …" so it can't be mistaken for real catalogue data, and `npm run db:purge-demo` removes it.
 * Never run this against a production database.
 *
 *   npm run db:seed:demo
 */
import "dotenv/config";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { db, getPool, schema } from "@/db";
import { hashPassword } from "@/lib/auth/core";
import { getDefaultLocationId, receiveIntoStock } from "@/lib/inventory";
import { importImage } from "@/lib/media";

const PASSWORD = "demo-password-123";

async function placeholder(label: string, hue: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1100">
    <rect width="900" height="1100" fill="#EFE6D6"/>
    <rect x="300" y="250" width="300" height="560" rx="18" fill="${hue}"/>
    <rect x="340" y="420" width="220" height="200" fill="#FFFCF6"/>
    <text x="450" y="510" font-family="Georgia" font-size="34" text-anchor="middle" fill="#3A1631">SAMPLE</text>
    <text x="450" y="560" font-family="Georgia" font-size="22" text-anchor="middle" fill="#3A1631">${label}</text>
    <text x="450" y="960" font-family="Helvetica" font-size="26" text-anchor="middle" fill="#8C8084">Placeholder image — sample data</text>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer();
}

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "true") throw new Error("Refusing to seed sample data with NODE_ENV=production.");
  const existing = await db.query.products.findFirst({ where: eq(schema.products.isDemo, true) });
  if (existing) {
    console.log("Sample data already present. Run npm run db:purge-demo first to recreate it.");
    return getPool().end();
  }
  const roles = await db.select().from(schema.roles);
  const role = (k: string) => roles.find((r) => r.key === k)!.id;
  const hash = await hashPassword(PASSWORD);
  for (const [key, email, name] of [
    ["MANAGER", "manager@demo.local", "Sample Manager"],
    ["CASHIER", "cashier@demo.local", "Sample Cashier"],
    ["INVENTORY_CLERK", "clerk@demo.local", "Sample Stock Clerk"],
    ["SUPPORT", "support@demo.local", "Sample Support"],
    ["CUSTOMER", "customer@demo.local", "Sample Customer"],
  ] as const) {
    const [u] = await db.insert(schema.users).values({ email, name, passwordHash: hash, roleId: role(key), isDemo: true }).onConflictDoNothing().returning();
    if (u && key === "CUSTOMER") await db.insert(schema.customers).values({ userId: u.id, name, email, phone: "254700000001", isDemo: true });
  }

  const [supplier] = await db.insert(schema.suppliers).values({ name: "Sample Supplier Ltd", contactName: "Sample Contact", phone: "254700000002", isDemo: true }).returning();
  const cats = await db.select().from(schema.categories);
  const cat = (slug: string) => cats.find((c) => c.slug === slug)?.id ?? null;
  const loc = await getDefaultLocationId();
  const items = [
    { name: "Sample Rose Body Oil", cat: "oils", type: "COSMETIC" as const, variant: "100 ml", price: 650, cost: 380, stock: 40, hue: "#B0205A", featured: true },
    { name: "Sample Black Seed Soap", cat: "soaps", type: "COSMETIC" as const, variant: "100 g", price: 300, cost: 150, stock: 60, hue: "#3A1631", featured: true },
    { name: "Sample Sandalwood Incense", cat: "incense", type: "INCENSE_FRAGRANCE" as const, variant: "Box of 20 sticks", price: 250, cost: 110, stock: 3, hue: "#A9502C", featured: true },
    { name: "Sample Bukhoor Blend", cat: "powders-bukhoor", type: "INCENSE_FRAGRANCE" as const, variant: "50 g jar", price: 900, cost: 520, stock: 0, hue: "#52203F", featured: false },
  ];
  for (const it of items) {
    const asset = await importImage(await placeholder(it.name.replace("Sample ", ""), it.hue), { originalName: "sample.jpg", sourceNote: "Generated placeholder (sample data)" });
    const [p] = await db
      .insert(schema.products)
      .values({
        name: it.name,
        slug: it.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        categoryId: cat(it.cat),
        productType: it.type,
        status: "PUBLISHED",
        needsReview: false,
        isFeatured: it.featured,
        description: "This is sample data for trying out the shop. It isn't a real product and will be removed before going live.",
        defaultSupplierId: supplier.id,
        isDemo: true,
      })
      .returning();
    const [v] = await db.insert(schema.productVariants).values({ productId: p.id, name: it.variant, sku: `SMP-${p.slug.slice(7, 13).toUpperCase()}`, priceCents: it.price * 100, reorderLevel: 5, reorderQty: 20 }).returning();
    await db.insert(schema.productImages).values({ productId: p.id, assetId: asset.id, alt: it.name, sortOrder: 0 });
    if (it.stock > 0) {
      await db.transaction((tx) =>
        receiveIntoStock(tx, { variantId: v.id, locationId: loc, qty: it.stock, unitCostCents: it.cost * 100, type: "INITIAL", reason: "Sample opening stock", refType: "MANUAL", refId: "demo", userId: null }),
      );
    }
  }
  await db.insert(schema.deliveryZones).values([
    { name: "Sample: Town centre", method: "LOCAL_DELIVERY", feeCents: 15000, freeOverCents: 300000, etaText: "same day if ordered before 2 pm", isDemo: true, sortOrder: 1 },
    { name: "Sample: Courier — rest of Kenya", method: "COURIER", feeCents: 35000, etaText: "1–3 working days", isDemo: true, sortOrder: 2 },
  ]);
  await db.insert(schema.promotions).values({ name: "Sample: 10% off with code SAMPLE10", code: "SAMPLE10", type: "PERCENT", value: 10, minOrderCents: 50000, isDemo: true });
  console.log(`Sample data created. Staff/customer logins use the password "${PASSWORD}":`);
  console.log("  manager@demo.local, cashier@demo.local, clerk@demo.local, support@demo.local, customer@demo.local");
  await getPool().end();
}

main().catch(async (e) => {
  console.error(e);
  await getPool().end();
  process.exit(1);
});
