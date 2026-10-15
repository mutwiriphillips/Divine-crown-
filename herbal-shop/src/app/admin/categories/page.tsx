import { asc, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireStaffPage } from "@/lib/auth/server";
import { ActionForm, FieldError, SubmitButton } from "@/components/forms";
import { Badge, PageHeader } from "@/components/ui";
import { categoryAction } from "../products/actions";

export const metadata = { title: "Categories" };

export default async function CategoriesPage() {
  await requireStaffPage("products.edit", "/admin/categories");
  const cats = await db
    .select({ c: schema.categories, n: sql<number>`(select count(*)::int from products p where p.category_id = ${schema.categories.id} and p.status <> 'ARCHIVED')` })
    .from(schema.categories)
    .orderBy(asc(schema.categories.sortOrder), asc(schema.categories.name));
  return (
    <>
      <PageHeader title="Categories" description="Categories organise the shop menu and filters. Hidden categories don't appear in the shop." />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr><th>Name</th><th>Parent</th><th>Order</th><th>Products</th><th>Shown</th><th /></tr>
            </thead>
            <tbody>
              {cats.map(({ c, n }) => (
                <tr key={c.id}>
                  <td colSpan={6} className="p-0">
                    <ActionForm action={categoryAction} className="grid grid-cols-[2fr_1.5fr_70px_70px_80px_auto] items-center gap-2 px-3 py-2">
                      <input type="hidden" name="id" value={c.id} />
                      <input className="input input-sm" name="name" defaultValue={c.name} aria-label="Name" />
                      <select className="input input-sm" name="parentId" defaultValue={c.parentId ?? ""} aria-label="Parent">
                        <option value="">Top level</option>
                        {cats.filter((x) => x.c.id !== c.id).map((x) => (
                          <option key={x.c.id} value={x.c.id}>{x.c.name}</option>
                        ))}
                      </select>
                      <input className="input input-sm" name="sortOrder" type="number" defaultValue={c.sortOrder} aria-label="Order" />
                      <span className="text-center tabular-nums">{n}</span>
                      <span>{c.isActive ? <Badge tone="ok">Shown</Badge> : <Badge>Hidden</Badge>}</span>
                      <span className="flex gap-1">
                        <SubmitButton className="btn-secondary btn-sm">Save</SubmitButton>
                        <SubmitButton className="btn-ghost btn-sm" name="op" value="toggle">{c.isActive ? "Hide" : "Show"}</SubmitButton>
                      </span>
                    </ActionForm>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ActionForm action={categoryAction} className="card space-y-3 p-5" resetOnSuccess>
          <h2 className="text-lg">Add a category</h2>
          <div>
            <label className="field-label" htmlFor="new-name">Name</label>
            <input className="input" id="new-name" name="name" required />
            <FieldError name="name" />
          </div>
          <div>
            <label className="field-label" htmlFor="new-parent">Inside</label>
            <select className="input" id="new-parent" name="parentId" defaultValue="">
              <option value="">Top level</option>
              {cats.map((x) => (
                <option key={x.c.id} value={x.c.id}>{x.c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="new-desc">Short description</label>
            <input className="input" id="new-desc" name="description" />
          </div>
          <input type="hidden" name="sortOrder" value="99" />
          <SubmitButton>Add category</SubmitButton>
        </ActionForm>
      </div>
    </>
  );
}
