import { requireStaffPage } from "@/lib/auth/server";
import { PRODUCT_CSV_COLUMNS } from "@/lib/products";
import { ActionForm, SubmitButton } from "@/components/forms";
import { PageHeader } from "@/components/ui";
import { importProductsAction } from "./actions";

export const metadata = { title: "Import & export products" };

export default async function ImportPage() {
  await requireStaffPage("products.import", "/admin/products/import");
  return (
    <>
      <PageHeader title="Import & export products" description="Download the catalogue as a spreadsheet, edit prices or codes, then upload it back." />
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="mb-2 text-lg">Export</h2>
          <p className="mb-4 text-sm text-ink-soft">One row per size/variant. Open it in Excel or Google Sheets.</p>
          <a className="btn-secondary" href="/admin/products/export">Download products CSV</a>
        </section>
        <section className="card p-5">
          <h2 className="mb-2 text-lg">Import</h2>
          <ul className="mb-4 list-disc space-y-1 pl-5 text-sm text-ink-soft">
            <li>Rows are matched by <code>variant_id</code>, then by <code>sku</code>. Other rows become new draft products.</li>
            <li>Empty cells leave existing values unchanged. Prices are whole shillings, e.g. 1250.</li>
            <li>Import never publishes products — publish each one after review.</li>
            <li>If any row has a problem, nothing is imported.</li>
          </ul>
          <ActionForm action={importProductsAction} className="space-y-3">
            <input type="file" name="file" accept=".csv,text/csv" className="block text-sm" required />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="checkbox" name="dryRun" defaultChecked /> Check only (don&apos;t save yet)
            </label>
            <SubmitButton pendingText="Reading file…">Upload</SubmitButton>
          </ActionForm>
          <p className="mt-4 text-[13px] text-ink-soft">Columns: {PRODUCT_CSV_COLUMNS.join(", ")}</p>
        </section>
      </div>
    </>
  );
}
