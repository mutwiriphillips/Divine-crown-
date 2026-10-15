import { desc } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireStaffPage } from "@/lib/auth/server";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, EmptyState, fmtDate, PageHeader } from "@/components/ui";
import { handleDataRequestAction } from "../actions";

export const metadata = { title: "Privacy requests" };

export default async function PrivacyPage() {
  await requireStaffPage("customers.export", "/admin/settings/privacy");
  const reqs = await db.query.dataRequests.findMany({ orderBy: desc(schema.dataRequests.createdAt), with: { customer: true }, limit: 100 });
  return (
    <>
      <PageHeader title="Privacy requests" description="Customers can download their own data from their account. Deletion requests come here. Deleting removes names and contact details everywhere; order and payment records stay (without identity) for tax and accounting." />
      {reqs.length === 0 ? <EmptyState title="No requests">Nothing waiting.</EmptyState> : (
        <div className="space-y-3">
          {reqs.map((r) => (
            <div key={r.id} className="card flex flex-wrap items-start justify-between gap-4 p-4">
              <div>
                <p className="font-semibold">{r.type === "DELETE" ? "Delete my data" : "Data export"} · {r.customer.name}</p>
                <p className="text-sm text-ink-soft">Requested {fmtDate(r.createdAt, true)}{r.note ? ` · “${r.note}”` : ""}</p>
                <Badge tone={r.status === "PENDING" ? "warn" : r.status === "COMPLETED" ? "ok" : "neutral"}>{r.status.toLowerCase()}</Badge>
              </div>
              {r.status === "PENDING" ? (
                <div className="flex flex-wrap gap-2">
                  <ActionForm action={handleDataRequestAction} confirm="Delete this customer's personal data? This can't be undone.">
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="op" value="complete" />
                    <SubmitButton className="btn-danger btn-sm">Delete personal data</SubmitButton>
                  </ActionForm>
                  <ActionForm action={handleDataRequestAction} className="flex gap-1">
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="op" value="reject" />
                    <input className="input input-sm" name="note" placeholder="Reason for refusing" aria-label="Reason" />
                    <SubmitButton className="btn-secondary btn-sm">Refuse</SubmitButton>
                  </ActionForm>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
