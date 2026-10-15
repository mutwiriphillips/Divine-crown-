/**
 * Remove all sample data (rows flagged is_demo, and everything that hangs off them) before going live.
 *   npm run db:purge-demo            show what would be removed
 *   npm run db:purge-demo -- --yes   remove it
 *
 * Refuses if a real (non-sample) order contains a sample product, because deleting it would damage
 * real financial records.
 */
import "dotenv/config";
import "../src/lib/env-cleanup";
import { sql } from "drizzle-orm";
import { db, getPool } from "@/db";

async function count(q: ReturnType<typeof sql>) {
  const r = await db.execute<{ n: number }>(q);
  return Number(r.rows[0].n);
}

async function main() {
  const yes = process.argv.includes("--yes");
  const blocking = await count(sql`select count(*)::int as n from orders o where o.is_demo = false and exists (
      select 1 from order_items oi join product_variants v on v.id = oi.variant_id join products p on p.id = v.product_id where oi.order_id = o.id and p.is_demo)`);
  if (blocking) throw new Error(`${blocking} real order(s) include sample products. Refusing to purge.`);
  const summary = {
    orders: await count(sql`select count(*)::int as n from orders where is_demo`),
    products: await count(sql`select count(*)::int as n from products where is_demo`),
    users: await count(sql`select count(*)::int as n from users where is_demo`),
    customers: await count(sql`select count(*)::int as n from customers where is_demo`),
    suppliers: await count(sql`select count(*)::int as n from suppliers where is_demo`),
    deliveryZones: await count(sql`select count(*)::int as n from delivery_zones where is_demo`),
    promotions: await count(sql`select count(*)::int as n from promotions where is_demo`),
  };
  console.log("Sample data found:", summary);
  if (!yes) {
    console.log("Nothing removed. Re-run with --yes to delete it.");
    return getPool().end();
  }
  await db.transaction(async (tx) => {
    await tx.execute(sql`set local app.allow_purge = 'on'`);
    const demoOrders = sql`(select id from orders where is_demo)`;
    const demoVariants = sql`(select v.id from product_variants v join products p on p.id = v.product_id where p.is_demo)`;
    const demoUsers = sql`(select id from users where is_demo)`;
    const demoCustomers = sql`(select id from customers where is_demo or user_id in ${demoUsers})`;
    for (const q of [
      sql`delete from promotion_redemptions where order_id in ${demoOrders} or promotion_id in (select id from promotions where is_demo)`,
      sql`delete from reviews where order_id in ${demoOrders} or customer_id in ${demoCustomers} or product_id in (select id from products where is_demo)`,
      sql`delete from ticket_messages where ticket_id in (select id from support_tickets where order_id in ${demoOrders} or customer_id in ${demoCustomers})`,
      sql`delete from support_tickets where order_id in ${demoOrders} or customer_id in ${demoCustomers}`,
      sql`delete from documents where order_id in ${demoOrders}`,
      sql`delete from refund_items where refund_id in (select id from refunds where order_id in ${demoOrders})`,
      sql`delete from refunds where order_id in ${demoOrders}`,
      sql`delete from payments where order_id in ${demoOrders}`,
      sql`delete from payment_attempts where order_id in ${demoOrders}`,
      sql`delete from deliveries where order_id in ${demoOrders}`,
      sql`delete from order_events where order_id in ${demoOrders}`,
      sql`delete from order_items where order_id in ${demoOrders}`,
      sql`delete from cash_movements where ref_type = 'ORDER' and ref_id in (select id::text from orders where is_demo)`,
      sql`delete from orders where is_demo`,
      sql`delete from stock_movements where variant_id in ${demoVariants}`,
      sql`delete from stock_batches where variant_id in ${demoVariants}`,
      sql`delete from inventory_balances where variant_id in ${demoVariants}`,
      sql`delete from cart_items where variant_id in ${demoVariants}`,
      sql`delete from bundle_items where component_variant_id in ${demoVariants} or bundle_variant_id in ${demoVariants}`,
      sql`delete from goods_receipt_items where variant_id in ${demoVariants}`,
      sql`delete from purchase_order_items where variant_id in ${demoVariants}`,
      sql`delete from product_questions where product_id in (select id from products where is_demo)`,
      sql`delete from product_images where product_id in (select id from products where is_demo)`,
      sql`delete from product_variants where id in ${demoVariants}`,
      sql`delete from products where is_demo`,
      sql`delete from media_assets m where m.source_note = 'Generated placeholder (sample data)' and not exists (select 1 from product_images pi where pi.asset_id = m.id)`,
      sql`delete from carts where customer_id in ${demoCustomers}`,
      sql`delete from addresses where customer_id in ${demoCustomers}`,
      sql`delete from data_requests where customer_id in ${demoCustomers}`,
      sql`delete from customers where id in ${demoCustomers}`,
      sql`delete from cash_movements where session_id in (select id from pos_sessions where cashier_id in ${demoUsers})`,
      sql`delete from suspended_sales where session_id in (select id from pos_sessions where cashier_id in ${demoUsers})`,
      sql`update orders set pos_session_id = null where pos_session_id in (select id from pos_sessions where cashier_id in ${demoUsers})`,
      sql`delete from pos_sessions where cashier_id in ${demoUsers}`,
      sql`delete from expenses where is_demo`,
      sql`delete from goods_receipts where supplier_id in (select id from suppliers where is_demo)`,
      sql`delete from supplier_payments where supplier_id in (select id from suppliers where is_demo)`,
      sql`delete from supplier_invoices where supplier_id in (select id from suppliers where is_demo)`,
      sql`delete from purchase_orders where supplier_id in (select id from suppliers where is_demo) or is_demo`,
      sql`update products set default_supplier_id = null where default_supplier_id in (select id from suppliers where is_demo)`,
      sql`delete from suppliers where is_demo`,
      sql`update orders set delivery_zone_id = null where delivery_zone_id in (select id from delivery_zones where is_demo)`,
      sql`delete from delivery_zones where is_demo`,
      sql`delete from promotions where is_demo`,
      sql`update audit_logs set user_id = null where user_id in ${demoUsers}`,
      sql`delete from users where is_demo`,
    ]) {
      await tx.execute(q);
    }
  });
  console.log("Sample data removed.");
  await getPool().end();
}

main().catch(async (e) => {
  console.error(e.message ?? e);
  await getPool().end();
  process.exit(1);
});
