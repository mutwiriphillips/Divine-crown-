import { asc } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireStaffPage } from "@/lib/auth/server";
import { ActionForm, FieldError, SubmitButton } from "@/components/forms";
import { Field, PageHeader } from "@/components/ui";
import { createProductAction } from "../actions";

export const metadata = { title: "Add product" };

export default async function NewProductPage() {
  await requireStaffPage("products.edit", "/admin/products/new");
  const cats = await db.select().from(schema.categories).orderBy(asc(schema.categories.sortOrder));
  return (
    <>
      <PageHeader title="Add product" description="Start with the basics. You'll add photos, prices and stock on the next screen." />
      <ActionForm action={createProductAction} className="card grid max-w-2xl gap-4 p-5">
        <Field label="Name" name="name" hint="Use the exact name on the label.">
          <input className="input" id="name" name="name" required />
          <FieldError name="name" />
        </Field>
        <Field label="Category" name="categoryId">
          <select className="input" id="categoryId" name="categoryId" defaultValue="">
            <option value="">Choose later</option>
            {cats.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Product type" name="productType">
          <select className="input" id="productType" name="productType" defaultValue="OTHER">
            <option value="COSMETIC">Cosmetic / body care</option>
            <option value="HOUSEHOLD">Household</option>
            <option value="TRADITIONAL_SPIRITUAL">Traditional or spiritual use</option>
            <option value="INCENSE_FRAGRANCE">Incense & fragrance</option>
            <option value="HERBAL_CONSUMABLE">Herbal tea / supplement (consumed)</option>
            <option value="BUNDLE">Bundle of other products</option>
            <option value="OTHER">Other</option>
          </select>
        </Field>
        <Field label="First size or variant" name="variantName" hint="e.g. 100 ml, 250 g, Box of 12. You can add more later.">
          <input className="input" id="variantName" name="variantName" placeholder="Standard" />
        </Field>
        <div>
          <SubmitButton>Create draft</SubmitButton>
        </div>
      </ActionForm>
    </>
  );
}
