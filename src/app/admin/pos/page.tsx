import Link from "next/link";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireStaffPage } from "@/lib/auth/server";
import { availability, getDefaultLocationId } from "@/lib/inventory";
import { imageCrop, mediaUrl } from "@/lib/media";
import { mpesaMode } from "@/lib/payments/mpesa";
import { expectedCash } from "@/lib/pos";
import { getSetting } from "@/lib/settings";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, Money, PageHeader } from "@/components/ui";
import { cashMovementAction, closeShiftAction, completeSaleAction, customerSearchAction, openShiftAction, posQuoteAction, quickCustomerAction, resumeSaleAction, suspendSaleAction } from "./actions";
import { PosApp } from "./pos-app";

export const metadata = { title: "Point of sale" };

export default async function PosPage() {
  const user = await requireStaffPage("pos.use", "/admin/pos");
  const session = await db.query.posSessions.findFirst({ where: and(eq(schema.posSessions.cashierId, user.id), eq(schema.posSessions.status, "OPEN")), with: { location: true } });
  const locations = await db.select().from(schema.locations).where(eq(schema.locations.isActive, true));

  if (!session) {
    const def = await getDefaultLocationId();
    return (
      <>
        <PageHeader title="Point of sale" description="Open your shift by counting the cash in the drawer." actions={<Link className="btn-secondary" href="/admin/pos/shifts">Past shifts</Link>} />
        <ActionForm action={openShiftAction} className="card max-w-md space-y-4 p-5">
          <Field label="Cash in the drawer now (KES)" hint="Count the float before your first sale.">
            <input className="input text-xl" name="float" inputMode="decimal" required autoFocus />
          </Field>
          {locations.length > 1 ? (
            <Field label="Shop">
              <select className="input" name="locationId" defaultValue={def}>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
            </Field>
          ) : null}
          <SubmitButton>Open shift</SubmitButton>
        </ActionForm>
      </>
    );
  }

  const [rows, cats, held, commerce, expected] = await Promise.all([
    db
      .select({ v: schema.productVariants, p: schema.products })
      .from(schema.productVariants)
      .innerJoin(schema.products, eq(schema.products.id, schema.productVariants.productId))
      .where(sql`${schema.products.status} <> 'ARCHIVED' and not ${schema.products.needsReview} and ${schema.productVariants.isActive} and ${schema.productVariants.priceCents} is not null`)
      .orderBy(asc(schema.products.name)),
    db.select({ id: schema.categories.id, name: schema.categories.name }).from(schema.categories).where(eq(schema.categories.isActive, true)).orderBy(asc(schema.categories.sortOrder)),
    db.query.suspendedSales.findMany({ where: and(eq(schema.suspendedSales.sessionId, session.id), isNull(schema.suspendedSales.resumedAt)), orderBy: (s) => s.createdAt }),
    getSetting("commerce"),
    expectedCash(session.id),
  ]);
  const avail = await availability(db, rows.map((r) => r.v.id), session.locationId);
  const images = rows.length
    ? await db.execute<{ product_id: string; asset_id: string; crop_x: number | null; crop_y: number | null; crop_w: number | null; crop_h: number | null }>(
        sql`select distinct on (product_id) product_id, asset_id, crop_x, crop_y, crop_w, crop_h from product_images order by product_id, sort_order`,
      )
    : { rows: [] };
  const imgMap = new Map(images.rows.map((i) => [i.product_id, mediaUrl(i.asset_id, 160, imageCrop({ cropX: i.crop_x, cropY: i.crop_y, cropW: i.crop_w, cropH: i.crop_h }))]));
  const products = rows.map(({ v, p }) => ({
    variantId: v.id,
    name: p.name,
    variant: v.name,
    sku: v.sku,
    barcode: v.barcode,
    priceCents: v.priceCents!,
    categoryId: p.categoryId,
    available: avail.get(v.id) ?? 0,
    image: imgMap.get(p.id) ?? null,
  }));

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl">Point of sale <span className="text-base text-ink-soft">· {session.location.name} · shift opened {session.openedAt.toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Nairobi" })}</span></h1>
        <details className="relative">
          <summary className="btn-secondary btn-sm cursor-pointer list-none">Cash drawer & close shift</summary>
          <div className="absolute right-0 z-20 mt-2 w-80 space-y-4 rounded-md border border-line bg-white p-4 shadow-lg">
            <p className="text-sm">Expected in drawer: <strong><Money cents={expected} /></strong></p>
            <ActionForm action={cashMovementAction} className="space-y-2" resetOnSuccess>
              <input type="hidden" name="sessionId" value={session.id} />
              <select className="input input-sm" name="type" aria-label="Type"><option value="PAY_OUT">Pay out (e.g. buy supplies)</option><option value="PAY_IN">Pay in (add change)</option><option value="CASH_DROP">Remove cash to safe</option></select>
              <input className="input input-sm" name="amount" inputMode="decimal" placeholder="Amount (KES)" aria-label="Amount" required />
              <input className="input input-sm" name="reason" placeholder="Reason" aria-label="Reason" required />
              <SubmitButton className="btn-secondary btn-sm">Record</SubmitButton>
            </ActionForm>
            <ActionForm action={closeShiftAction} className="space-y-2 border-t border-line pt-3" confirm="Close your shift? You'll need to open a new one to sell again.">
              <input type="hidden" name="sessionId" value={session.id} />
              <p className="text-sm font-semibold">Close shift</p>
              <input className="input input-sm" name="counted" inputMode="decimal" placeholder="Cash counted (KES)" aria-label="Cash counted" required />
              <input className="input input-sm" name="note" placeholder="Note (needed if it doesn't balance)" aria-label="Note" />
              <SubmitButton className="btn-primary btn-sm">Close shift</SubmitButton>
            </ActionForm>
            <Link className="link text-sm" href={`/admin/pos/shifts/${session.id}`}>Shift summary so far</Link>
          </div>
        </details>
      </div>
      <PosApp
        sessionId={session.id}
        products={products}
        categories={cats.filter((c) => products.some((p) => p.categoryId === c.id))}
        held={held.map((h) => ({ id: h.id, label: h.label, createdAt: h.createdAt.toISOString() }))}
        perms={{ discount: user.permissions.includes("pos.discount"), override: user.permissions.includes("pos.price_override") }}
        manualMpesa={commerce.posAllowManualMpesaCode}
        stkAvailable={mpesaMode() !== "disabled"}
        actions={{
          quote: posQuoteAction,
          complete: completeSaleAction,
          suspend: suspendSaleAction,
          resume: resumeSaleAction,
          searchCustomers: customerSearchAction,
          quickCustomer: quickCustomerAction,
        }}
      />
    </>
  );
}
