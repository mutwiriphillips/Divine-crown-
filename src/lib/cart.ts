import "server-only";
import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { db, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth/server";
import { randomToken, sha256 } from "@/lib/crypto";

const CART_COOKIE = "cart";
export const MAX_LINE_QTY = 99;

/** The signed-in customer's profile id, creating one for staff/customers who don't have one yet. */
export async function currentCustomerId(): Promise<string | null> {
  const u = await getCurrentUser();
  if (!u) return null;
  const c = await db.query.customers.findFirst({ where: eq(schema.customers.userId, u.id) });
  if (c) return c.id;
  const [row] = await db.insert(schema.customers).values({ userId: u.id, name: u.name, email: u.email, phone: u.phone }).returning();
  return row.id;
}

async function guestToken(create: boolean): Promise<string | null> {
  const jar = await cookies();
  const t = jar.get(CART_COOKIE)?.value;
  if (t) return t;
  if (!create) return null;
  const nt = randomToken(24);
  jar.set(CART_COOKIE, nt, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "true",
    path: "/",
    maxAge: 60 * 60 * 24 * 60,
  });
  return nt;
}

/**
 * Find (or create) the visitor's cart. Signed-in customers keep their cart across devices; a guest cart
 * is merged into the customer's cart the first time they're seen signed in.
 */
export async function getCart(create: boolean) {
  const customerId = await currentCustomerId();
  const token = await guestToken(create && !customerId);
  const guestCart = token ? await db.query.carts.findFirst({ where: eq(schema.carts.tokenHash, sha256(token)) }) : null;
  if (customerId) {
    let cart = await db.query.carts.findFirst({ where: eq(schema.carts.customerId, customerId) });
    if (!create) return cart ?? guestCart ?? null;
    if (guestCart && guestCart.id !== cart?.id) {
      if (!cart) {
        await db.update(schema.carts).set({ customerId, tokenHash: null }).where(eq(schema.carts.id, guestCart.id));
        cart = { ...guestCart, customerId, tokenHash: null };
      } else {
        const items = await db.select().from(schema.cartItems).where(eq(schema.cartItems.cartId, guestCart.id));
        for (const it of items) {
          await db
            .insert(schema.cartItems)
            .values({ cartId: cart.id, variantId: it.variantId, qty: it.qty })
            .onConflictDoUpdate({ target: [schema.cartItems.cartId, schema.cartItems.variantId], set: { qty: it.qty } });
        }
        await db.delete(schema.carts).where(eq(schema.carts.id, guestCart.id));
      }
      (await cookies()).delete(CART_COOKIE);
    }
    if (!cart && create) [cart] = await db.insert(schema.carts).values({ customerId }).returning();
    return cart ?? null;
  }
  if (guestCart) return guestCart;
  if (!create || !token) return null;
  const [cart] = await db.insert(schema.carts).values({ tokenHash: sha256(token) }).returning();
  return cart;
}

export async function cartLines(cartId: string) {
  return db.select({ variantId: schema.cartItems.variantId, qty: schema.cartItems.qty }).from(schema.cartItems).where(eq(schema.cartItems.cartId, cartId));
}

export async function setLineQty(cartId: string, variantId: string, qty: number) {
  const q = Math.min(MAX_LINE_QTY, Math.max(0, Math.floor(qty)));
  if (q === 0) {
    await db.delete(schema.cartItems).where(and(eq(schema.cartItems.cartId, cartId), eq(schema.cartItems.variantId, variantId)));
  } else {
    await db
      .insert(schema.cartItems)
      .values({ cartId, variantId, qty: q })
      .onConflictDoUpdate({ target: [schema.cartItems.cartId, schema.cartItems.variantId], set: { qty: q } });
  }
  await db.update(schema.carts).set({ updatedAt: new Date(), reminderSentAt: null }).where(eq(schema.carts.id, cartId));
}

export async function cartCount(): Promise<number> {
  const cart = await getCart(false).catch(() => null);
  if (!cart) return 0;
  const lines = await cartLines(cart.id);
  return lines.reduce((a, l) => a + l.qty, 0);
}

export async function clearGuestCart() {
  const jar = await cookies();
  const t = jar.get(CART_COOKIE)?.value;
  if (t) {
    await db.delete(schema.carts).where(eq(schema.carts.tokenHash, sha256(t)));
    jar.delete(CART_COOKIE);
  }
}

/**
 * Bring the stored cart in line with what can actually be sold: drop unavailable items and reduce
 * quantities to what's in stock. The customer is shown the matching messages, so nothing changes silently.
 */
export async function reconcileCart(cartId: string, priced: { lines: { variantId: string; qty: number }[]; issues: { variantId?: string; code: string }[] }) {
  for (const i of priced.issues) {
    if (!i.variantId) continue;
    if (i.code === "qty_reduced") {
      const l = priced.lines.find((x) => x.variantId === i.variantId);
      if (l) await setLineQty(cartId, i.variantId, l.qty);
    } else if (["missing", "unavailable", "out_of_stock", "no_price"].includes(i.code)) {
      await setLineQty(cartId, i.variantId, 0);
    }
  }
}
