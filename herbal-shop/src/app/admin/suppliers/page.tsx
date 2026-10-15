import Link from "next/link";
import { requireStaffPage } from "@/lib/auth/server";
import { supplierBalances } from "@/lib/purchasing";
import { ActionForm, SubmitButton } from "@/components/forms";
import { EmptyState, Money, PageHeader } from "@/components/ui";
import { supplierAction } from "../purchasing/actions";

export const metadata = { title: "Suppliers" };

export default async function SuppliersPage() {
  await requireStaffPage("purchasing.manage", "/admin/suppliers");
  const rows = await supplierBalances();
  return (
    <>
      <PageHeader title="Suppliers" description="Balance = supplier invoices recorded minus payments made." />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        {rows.length === 0 ? <EmptyState title="No suppliers yet">Add the people and companies you buy stock from.</EmptyState> : (
          <div className="card overflow-x-auto">
            <table className="table">
              <thead><tr><th>Supplier</th><th className="text-right">Invoiced</th><th className="text-right">Paid</th><th className="text-right">Balance owed</th></tr></thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.supplierId}>
                    <td><Link className="font-semibold text-plum hover:underline" href={`/admin/suppliers/${s.supplierId}`}>{s.name}</Link></td>
                    <td className="text-right"><Money cents={s.invoiced} /></td>
                    <td className="text-right"><Money cents={s.paid} /></td>
                    <td className={`text-right ${s.balance > 0 ? "font-semibold text-warn" : ""}`}><Money cents={s.balance} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <ActionForm action={supplierAction} className="card space-y-3 p-5">
          <h2 className="text-lg">Add a supplier</h2>
          <input className="input" name="name" placeholder="Business name" required aria-label="Business name" />
          <input className="input" name="contactName" placeholder="Contact person" aria-label="Contact person" />
          <input className="input" name="phone" placeholder="Phone" aria-label="Phone" />
          <input className="input" name="email" type="email" placeholder="Email" aria-label="Email" />
          <input className="input" name="address" placeholder="Location / address" aria-label="Address" />
          <SubmitButton>Add supplier</SubmitButton>
        </ActionForm>
      </div>
    </>
  );
}
