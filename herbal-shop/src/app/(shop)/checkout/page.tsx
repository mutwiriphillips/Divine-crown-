import { redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth/server";
import { cartLines, currentCustomerId, getCart } from "@/lib/cart";
import { mpesaMode } from "@/lib/payments/mpesa";
import { getAllSettings } from "@/lib/settings";
import { placeOrderAction, quoteCheckout } from "../actions";
import { CheckoutForm } from "./checkout-form";

export const metadata = { title: "Checkout" };

export default async function CheckoutPage() {
  const cart = await getCart(false);
  const lines = cart ? await cartLines(cart.id) : [];
  if (!cart || !lines.length) redirect("/cart");
  const { business, commerce } = await getAllSettings();
  const user = await getCurrentUser();
  if (!user && !commerce.guestCheckout) redirect("/login?next=/checkout");
  const customerId = user ? await currentCustomerId() : null;
  const [customer, address, zones] = await Promise.all([
    customerId ? db.query.customers.findFirst({ where: eq(schema.customers.id, customerId) }) : null,
    customerId ? db.query.addresses.findFirst({ where: and(eq(schema.addresses.customerId, customerId), eq(schema.addresses.isDefault, true)) }) : null,
    db.query.deliveryZones.findMany({ where: eq(schema.deliveryZones.isActive, true), orderBy: (z) => z.sortOrder }),
  ]);
  const initial = await quoteCheckout({ fulfilment: commerce.collectionEnabled ? "COLLECTION" : "LOCAL_DELIVERY", deliveryZoneId: null });
  const variants = await db.query.productVariants.findMany({ where: inArray(schema.productVariants.id, lines.map((l) => l.variantId)), with: { product: true } });
  const priceLines = lines
    .map((l) => {
      const v = variants.find((x) => x.id === l.variantId);
      return v ? { name: `${v.product.name}${v.name !== "Standard" ? ` (${v.name})` : ""}`, qty: l.qty, totalCents: (v.priceCents ?? 0) * l.qty } : null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
  const shippingNotes = [...new Set(variants.map((v) => v.product.shippingRestriction).filter((x): x is string => !!x))].map((n) => n);
  const localPhone = (customer?.phone ?? user?.phone ?? "").replace(/^254/, "0");

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="mb-6 text-4xl">Checkout</h1>
      <CheckoutForm
        action={placeOrderAction}
        quote={quoteCheckout}
        initialQuote={initial}
        zones={zones.map((z) => ({ id: z.id, name: z.name, method: z.method, feeCents: z.feeCents, freeOverCents: z.freeOverCents, etaText: z.etaText }))}
        collectionEnabled={commerce.collectionEnabled}
        collectionAddress={commerce.collectionAddress || [business.address, business.town].filter(Boolean).join(", ")}
        codEnabled={commerce.cashOnDelivery}
        mpesaEnabled={mpesaMode() !== "disabled"}
        defaults={{
          name: customer?.name ?? user?.name ?? "",
          phone: localPhone,
          email: customer?.email ?? user?.email ?? "",
          county: address?.county ?? "",
          town: address?.town ?? "",
          area: address?.area ?? "",
          street: address?.street ?? "",
          landmark: address?.landmark ?? "",
        }}
        lines={priceLines}
        shippingNotes={shippingNotes}
      />
    </div>
  );
}
