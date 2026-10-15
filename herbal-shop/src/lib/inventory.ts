import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import { db, schema, type Executor, type Tx } from "@/db";

/**
 * Stock engine.
 *
 * Every change to a balance goes through `applyMovement`, which performs a single conditional UPDATE
 * (row-locked by Postgres) and writes an immutable ledger row in the same transaction. The UPDATE only
 * succeeds if the resulting balance is valid, so two simultaneous orders can never both take the last unit.
 * Balances are always touched in a stable order (sorted variant ids) to avoid deadlocks.
 */

export class InsufficientStockError extends Error {
  constructor(
    public variantId: string,
    public requested: number,
    message?: string,
  ) {
    super(message ?? "Not enough stock available.");
    this.name = "InsufficientStockError";
  }
}

type MovementType = (typeof schema.stockMovementType.enumValues)[number];

export type MovementInput = {
  variantId: string;
  locationId: string;
  type: MovementType;
  onHandDelta?: number;
  reservedDelta?: number;
  quarantineDelta?: number;
  reason: string;
  refType?: string;
  refId?: string;
  userId?: string | null;
  unitCostCents?: number | null;
  batchNo?: string | null;
};

export async function ensureBalance(tx: Executor, variantId: string, locationId: string) {
  await tx
    .insert(schema.inventoryBalances)
    .values({ variantId, locationId })
    .onConflictDoNothing({ target: [schema.inventoryBalances.variantId, schema.inventoryBalances.locationId] });
}

export async function applyMovement(tx: Tx, m: MovementInput) {
  const dOn = m.onHandDelta ?? 0;
  const dRes = m.reservedDelta ?? 0;
  const dQ = m.quarantineDelta ?? 0;
  if (dOn === 0 && dRes === 0 && dQ === 0) throw new Error("Stock movement with no effect");
  await ensureBalance(tx, m.variantId, m.locationId);
  const res = await tx.execute<{ on_hand: number }>(sql`
    update inventory_balances
       set on_hand = on_hand + ${dOn},
           reserved = reserved + ${dRes},
           quarantined = quarantined + ${dQ},
           updated_at = now()
     where variant_id = ${m.variantId} and location_id = ${m.locationId}
       and on_hand + ${dOn} >= 0
       and reserved + ${dRes} >= 0
       and reserved + ${dRes} <= on_hand + ${dOn}
       and quarantined + ${dQ} >= 0
     returning on_hand`);
  if (res.rows.length === 0) {
    throw new InsufficientStockError(m.variantId, Math.max(-dOn, dRes, -dQ));
  }
  await tx.insert(schema.stockMovements).values({
    variantId: m.variantId,
    locationId: m.locationId,
    type: m.type,
    onHandDelta: dOn,
    reservedDelta: dRes,
    quarantineDelta: dQ,
    onHandAfter: Number(res.rows[0].on_hand),
    reason: m.reason,
    refType: m.refType ?? null,
    refId: m.refId ?? null,
    userId: m.userId ?? null,
    unitCostCents: m.unitCostCents ?? null,
    batchNo: m.batchNo ?? null,
  });
  return Number(res.rows[0].on_hand);
}

export type StockLine = { variantId: string; qty: number };

/** Bundles hold no stock of their own: expand them into their components and merge duplicates. */
export async function expandBundles(exec: Executor, lines: StockLine[]): Promise<StockLine[]> {
  const ids = [...new Set(lines.map((l) => l.variantId))];
  if (ids.length === 0) return [];
  const variants = await exec
    .select({ id: schema.productVariants.id, isBundle: schema.productVariants.isBundle })
    .from(schema.productVariants)
    .where(inArray(schema.productVariants.id, ids));
  const bundleIds = variants.filter((v) => v.isBundle).map((v) => v.id);
  const comps = bundleIds.length
    ? await exec.select().from(schema.bundleItems).where(inArray(schema.bundleItems.bundleVariantId, bundleIds))
    : [];
  const merged = new Map<string, number>();
  for (const l of lines) {
    if (bundleIds.includes(l.variantId)) {
      const parts = comps.filter((c) => c.bundleVariantId === l.variantId);
      if (parts.length === 0) throw new Error("This bundle has no components configured.");
      for (const c of parts) merged.set(c.componentVariantId, (merged.get(c.componentVariantId) ?? 0) + c.qty * l.qty);
    } else {
      merged.set(l.variantId, (merged.get(l.variantId) ?? 0) + l.qty);
    }
  }
  return [...merged.entries()].map(([variantId, qty]) => ({ variantId, qty })).sort((a, b) => a.variantId.localeCompare(b.variantId));
}

/** Hold stock for an unpaid order. Throws InsufficientStockError if any line can't be held. */
export async function reserveStock(tx: Tx, locationId: string, lines: StockLine[], ref: { orderId: string; userId?: string | null }) {
  for (const l of await expandBundles(tx, lines)) {
    await applyMovement(tx, {
      variantId: l.variantId,
      locationId,
      type: "RESERVATION",
      reservedDelta: l.qty,
      reason: "Held for unpaid order",
      refType: "ORDER",
      refId: ref.orderId,
      userId: ref.userId,
    });
  }
}

export async function releaseReservation(tx: Tx, locationId: string, lines: StockLine[], ref: { orderId: string; userId?: string | null; reason: string }) {
  for (const l of await expandBundles(tx, lines)) {
    await applyMovement(tx, {
      variantId: l.variantId,
      locationId,
      type: "RESERVATION_RELEASE",
      reservedDelta: -l.qty,
      reason: ref.reason,
      refType: "ORDER",
      refId: ref.orderId,
      userId: ref.userId,
    });
  }
}

/**
 * Deduct sold stock. If `fromReservation`, the reserved quantity is consumed at the same time.
 * For batch-tracked variants, batches are drawn down earliest-expiry first.
 */
export async function commitSale(
  tx: Tx,
  locationId: string,
  lines: StockLine[],
  ref: { orderId: string; userId?: string | null; fromReservation: boolean },
) {
  const expanded = await expandBundles(tx, lines);
  for (const l of expanded) {
    const v = await tx.query.productVariants.findFirst({
      where: eq(schema.productVariants.id, l.variantId),
      columns: { avgCostCents: true, trackBatches: true },
    });
    const batchNo = v?.trackBatches ? await drawDownBatches(tx, l.variantId, locationId, l.qty) : null;
    await applyMovement(tx, {
      variantId: l.variantId,
      locationId,
      type: "SALE",
      onHandDelta: -l.qty,
      reservedDelta: ref.fromReservation ? -l.qty : 0,
      reason: "Sold",
      refType: "ORDER",
      refId: ref.orderId,
      userId: ref.userId,
      unitCostCents: v?.avgCostCents ?? null,
      batchNo,
    });
  }
}

/** Reduce batch quantities FEFO. Returns a description of batches used (for the ledger). */
async function drawDownBatches(tx: Tx, variantId: string, locationId: string, qty: number): Promise<string | null> {
  const batches = await tx
    .select()
    .from(schema.stockBatches)
    .where(and(eq(schema.stockBatches.variantId, variantId), eq(schema.stockBatches.locationId, locationId), gt(schema.stockBatches.qtyOnHand, 0)))
    .orderBy(sql`${schema.stockBatches.expiresAt} asc nulls last`, asc(schema.stockBatches.createdAt))
    .for("update");
  let remaining = qty;
  const used: string[] = [];
  for (const b of batches) {
    if (remaining <= 0) break;
    const take = Math.min(b.qtyOnHand, remaining);
    await tx
      .update(schema.stockBatches)
      .set({ qtyOnHand: b.qtyOnHand - take })
      .where(eq(schema.stockBatches.id, b.id));
    used.push(`${b.batchNo}×${take}`);
    remaining -= take;
  }
  // Remaining qty came from stock not recorded against a batch (e.g. opening stock).
  if (remaining > 0) used.push(`unbatched×${remaining}`);
  return used.length ? used.join(", ") : null;
}

/** Weighted average cost across all locations, updated when stock arrives at a known cost. */
export async function updateAverageCost(tx: Tx, variantId: string, incomingQty: number, unitCostCents: number) {
  const v = await tx.query.productVariants.findFirst({ where: eq(schema.productVariants.id, variantId), columns: { avgCostCents: true } });
  const totals = await tx.execute<{ qty: number }>(
    sql`select coalesce(sum(on_hand),0)::int as qty from inventory_balances where variant_id = ${variantId}`,
  );
  // Quantity on hand *before* the receipt is applied.
  const existingQty = Math.max(0, Number(totals.rows[0].qty));
  const oldAvg = v?.avgCostCents;
  const newAvg =
    oldAvg == null || existingQty <= 0
      ? unitCostCents
      : Math.round((existingQty * oldAvg + incomingQty * unitCostCents) / (existingQty + incomingQty));
  await tx.update(schema.productVariants).set({ avgCostCents: newAvg }).where(eq(schema.productVariants.id, variantId));
  return newAvg;
}

export async function receiveIntoStock(
  tx: Tx,
  args: {
    variantId: string;
    locationId: string;
    qty: number;
    unitCostCents: number | null;
    type: "PURCHASE_RECEIVED" | "INITIAL";
    reason: string;
    refType: string;
    refId: string;
    userId: string | null;
    batchNo?: string | null;
    expiresAt?: Date | null;
  },
) {
  if (args.qty <= 0) throw new Error("Quantity must be positive");
  if (args.unitCostCents != null) await updateAverageCost(tx, args.variantId, args.qty, args.unitCostCents);
  if (args.batchNo) {
    await tx
      .insert(schema.stockBatches)
      .values({ variantId: args.variantId, locationId: args.locationId, batchNo: args.batchNo, expiresAt: args.expiresAt ?? null, qtyOnHand: args.qty })
      .onConflictDoUpdate({
        target: [schema.stockBatches.variantId, schema.stockBatches.locationId, schema.stockBatches.batchNo],
        set: { qtyOnHand: sql`${schema.stockBatches.qtyOnHand} + ${args.qty}` },
      });
  }
  return applyMovement(tx, {
    variantId: args.variantId,
    locationId: args.locationId,
    type: args.type,
    onHandDelta: args.qty,
    reason: args.reason,
    refType: args.refType,
    refId: args.refId,
    userId: args.userId,
    unitCostCents: args.unitCostCents,
    batchNo: args.batchNo ?? null,
  });
}

/** Available-to-sell per variant at a location (bundles = min over components). */
export async function availability(exec: Executor, variantIds: string[], locationId: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (variantIds.length === 0) return out;
  const variants = await exec
    .select({ id: schema.productVariants.id, isBundle: schema.productVariants.isBundle })
    .from(schema.productVariants)
    .where(inArray(schema.productVariants.id, variantIds));
  const bundleIds = variants.filter((v) => v.isBundle).map((v) => v.id);
  const comps = bundleIds.length
    ? await exec.select().from(schema.bundleItems).where(inArray(schema.bundleItems.bundleVariantId, bundleIds))
    : [];
  const allIds = [...new Set([...variantIds, ...comps.map((c) => c.componentVariantId)])];
  const bal = await exec
    .select()
    .from(schema.inventoryBalances)
    .where(and(inArray(schema.inventoryBalances.variantId, allIds), eq(schema.inventoryBalances.locationId, locationId)));
  const avail = new Map(bal.map((b) => [b.variantId, b.onHand - b.reserved]));
  for (const v of variants) {
    if (v.isBundle) {
      const parts = comps.filter((c) => c.bundleVariantId === v.id);
      out.set(v.id, parts.length ? Math.min(...parts.map((p) => Math.floor((avail.get(p.componentVariantId) ?? 0) / p.qty))) : 0);
    } else {
      out.set(v.id, avail.get(v.id) ?? 0);
    }
  }
  return out;
}

export async function getDefaultLocationId(exec: Executor = db): Promise<string> {
  const loc = await exec.query.locations.findFirst({ where: eq(schema.locations.isDefault, true) });
  if (loc) return loc.id;
  const any = await exec.query.locations.findFirst();
  if (!any) throw new Error("No stock location exists. Run the setup seed first.");
  return any.id;
}

/**
 * Manual adjustments (count corrections, damage, expiry, transfers). Each requires a reason.
 * DAMAGE/EXPIRY move units out of sellable stock into quarantine; they are written off from there.
 */
export async function manualAdjustment(
  tx: Tx,
  args: {
    variantId: string;
    locationId: string;
    kind: "COUNT_CORRECTION" | "DAMAGE" | "EXPIRY" | "WRITE_OFF_QUARANTINE" | "RELEASE_QUARANTINE" | "SUPPLIER_RETURN" | "INITIAL";
    qty: number; // for COUNT_CORRECTION: signed delta; others: positive quantity
    reason: string;
    userId: string;
    unitCostCents?: number | null;
  },
) {
  const reason = args.reason.trim();
  if (reason.length < 3) throw new Error("Give a reason for the adjustment.");
  const base = { variantId: args.variantId, locationId: args.locationId, reason, refType: "MANUAL", userId: args.userId };
  const q = Math.abs(args.qty);
  if (!Number.isInteger(args.qty) || args.qty === 0) throw new Error("Enter a whole-number quantity other than zero.");
  switch (args.kind) {
    case "COUNT_CORRECTION":
      return applyMovement(tx, { ...base, type: "ADJUSTMENT", onHandDelta: args.qty });
    case "INITIAL":
      return receiveIntoStock(tx, {
        ...base,
        qty: q,
        unitCostCents: args.unitCostCents ?? null,
        type: "INITIAL",
        refId: "opening",
      });
    case "DAMAGE":
    case "EXPIRY":
      return applyMovement(tx, { ...base, type: args.kind, onHandDelta: -q, quarantineDelta: q });
    case "WRITE_OFF_QUARANTINE":
      return applyMovement(tx, { ...base, type: "QUARANTINE_WRITE_OFF", quarantineDelta: -q });
    case "RELEASE_QUARANTINE":
      return applyMovement(tx, { ...base, type: "ADJUSTMENT", quarantineDelta: -q, onHandDelta: q });
    case "SUPPLIER_RETURN":
      return applyMovement(tx, { ...base, type: "SUPPLIER_RETURN", onHandDelta: -q });
  }
}

export async function transferStock(
  tx: Tx,
  args: { variantId: string; fromLocationId: string; toLocationId: string; qty: number; reason: string; userId: string },
) {
  if (args.fromLocationId === args.toLocationId) throw new Error("Choose two different locations.");
  if (!Number.isInteger(args.qty) || args.qty <= 0) throw new Error("Enter a positive whole quantity.");
  const ref = crypto.randomUUID();
  // Lock order: always lower location id first.
  const steps = [
    { loc: args.fromLocationId, type: "TRANSFER_OUT" as const, d: -args.qty },
    { loc: args.toLocationId, type: "TRANSFER_IN" as const, d: args.qty },
  ].sort((a, b) => a.loc.localeCompare(b.loc));
  for (const s of steps) {
    await applyMovement(tx, {
      variantId: args.variantId,
      locationId: s.loc,
      type: s.type,
      onHandDelta: s.d,
      reason: args.reason,
      refType: "TRANSFER",
      refId: ref,
      userId: args.userId,
    });
  }
}
