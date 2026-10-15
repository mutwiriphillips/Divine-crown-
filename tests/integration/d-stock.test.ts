/** D. Receiving and adjusting stock: purchase orders, weighted cost, batches, adjustments, the immutable ledger. */
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db, schema } from "@/db";
import { getDefaultLocationId, manualAdjustment } from "@/lib/inventory";
import { createPurchaseOrder, receiveGoods, recordSupplierInvoice, setPurchaseOrderStatus, supplierBalances } from "@/lib/purchasing";
import { balance, makeProduct, makeUser, movements } from "../fixtures";

describe("D. stock receiving and adjustment", () => {
  it("receives a purchase order in parts, updates average cost, and is safe to submit twice", async () => {
    const clerk = await makeUser("INVENTORY_CLERK");
    const { variant } = await makeProduct({ priceKes: 600, stock: 10, costKes: 300 });
    const [supplier] = await db.insert(schema.suppliers).values({ name: `Test supplier ${randomUUID().slice(0, 6)}` }).returning();
    const loc = await getDefaultLocationId();
    const po = await createPurchaseOrder({ supplierId: supplier.id, locationId: loc, expectedAt: null, notes: null, items: [{ variantId: variant.id, qty: 10, unitCostCents: 36000 }], userId: clerk.id });
    await setPurchaseOrderStatus(po.id, "ORDERED", clerk.id);
    const poItem = (await db.query.purchaseOrderItems.findFirst({ where: eq(schema.purchaseOrderItems.poId, po.id) }))!;

    const args = { idempotencyKey: randomUUID(), poId: po.id, supplierId: supplier.id, locationId: loc, supplierInvoiceRef: null, notes: null, userId: clerk.id, items: [{ poItemId: poItem.id, variantId: variant.id, qty: 10, unitCostCents: 36000, batchNo: null, expiresAt: null }] };
    // Receiving more than was ordered is refused.
    await expect(receiveGoods({ ...args, idempotencyKey: randomUUID(), items: [{ ...args.items[0], qty: 11 }] })).rejects.toThrow(/more than is outstanding/);

    const part = await receiveGoods({ ...args, items: [{ ...args.items[0], qty: 4 }] });
    expect(part.duplicate).toBe(false);
    const again = await receiveGoods({ ...args, items: [{ ...args.items[0], qty: 4 }] });
    expect(again.duplicate).toBe(true);
    expect((await balance(variant.id)).onHand).toBe(14);
    expect((await db.query.purchaseOrders.findFirst({ where: eq(schema.purchaseOrders.id, po.id) }))?.status).toBe("PARTIALLY_RECEIVED");
    await receiveGoods({ ...args, idempotencyKey: randomUUID(), items: [{ ...args.items[0], qty: 6 }] });

    expect((await balance(variant.id)).onHand).toBe(20);
    const v = await db.query.productVariants.findFirst({ where: eq(schema.productVariants.id, variant.id) });
    expect(Math.abs((v?.avgCostCents ?? 0) - 33000)).toBeLessThanOrEqual(1); // (10 × 300 + 10 × 360) / 20, rounded per receipt
    expect((await db.query.purchaseOrders.findFirst({ where: eq(schema.purchaseOrders.id, po.id) }))?.status).toBe("RECEIVED");

    await recordSupplierInvoice({ supplierId: supplier.id, invoiceRef: "INV-1", amountCents: 360000, issuedAt: new Date(), dueAt: null, notes: null, poId: po.id, userId: clerk.id });
    expect((await supplierBalances()).find((s) => s.supplierId === supplier.id)?.balance).toBe(360000);
  });

  it("requires a batch number for batch-tracked products", async () => {
    const clerk = await makeUser("INVENTORY_CLERK");
    const { variant } = await makeProduct({ priceKes: 600, stock: 0, trackBatches: true });
    const [supplier] = await db.insert(schema.suppliers).values({ name: `Batch supplier ${randomUUID().slice(0, 6)}` }).returning();
    const base = { idempotencyKey: randomUUID(), poId: null, supplierId: supplier.id, locationId: await getDefaultLocationId(), supplierInvoiceRef: null, notes: null, userId: clerk.id };
    await expect(receiveGoods({ ...base, items: [{ poItemId: null, variantId: variant.id, qty: 5, unitCostCents: 100, batchNo: null, expiresAt: null }] })).rejects.toThrow(/batch number/);
    await receiveGoods({ ...base, idempotencyKey: randomUUID(), items: [{ poItemId: null, variantId: variant.id, qty: 5, unitCostCents: 100, batchNo: "B-001", expiresAt: new Date(Date.now() + 30 * 86400_000) }] });
    const batch = await db.query.stockBatches.findFirst({ where: eq(schema.stockBatches.variantId, variant.id) });
    expect(batch).toMatchObject({ batchNo: "B-001", qtyOnHand: 5 });
  });

  it("records adjustments with a reason, moves damage to quarantine, and never goes below zero", async () => {
    const clerk = await makeUser("INVENTORY_CLERK");
    const { variant } = await makeProduct({ priceKes: 200, stock: 5 });
    const loc = await getDefaultLocationId();
    const adj = (kind: Parameters<typeof manualAdjustment>[1]["kind"], qty: number, reason = "Stock count") =>
      db.transaction((tx) => manualAdjustment(tx, { variantId: variant.id, locationId: loc, kind, qty, reason, userId: clerk.id }));

    await expect(adj("COUNT_CORRECTION", -1, "")).rejects.toThrow(/reason/);
    await adj("DAMAGE", 2, "Bottles broke in transit");
    expect(await balance(variant.id)).toMatchObject({ onHand: 3, quarantined: 2 });
    await adj("WRITE_OFF_QUARANTINE", 2, "Disposed");
    expect(await balance(variant.id)).toMatchObject({ onHand: 3, quarantined: 0 });
    await expect(adj("COUNT_CORRECTION", -10)).rejects.toThrow();
    expect((await balance(variant.id)).onHand).toBe(3);
    const ledger = await movements(variant.id);
    expect(ledger.map((m) => m.type)).toEqual(["INITIAL", "DAMAGE", "QUARANTINE_WRITE_OFF"]);
    expect(ledger.every((m) => m.reason && m.reason.length > 0)).toBe(true);
  });

  it("the stock ledger cannot be edited or deleted", async () => {
    const { variant } = await makeProduct({ priceKes: 200, stock: 1 });
    const [m] = await movements(variant.id);
    await expect(db.execute(sql`update stock_movements set on_hand_delta = 100 where id = ${m.id}`)).rejects.toThrow();
    await expect(db.execute(sql`delete from stock_movements where id = ${m.id}`)).rejects.toThrow();
  });
});
