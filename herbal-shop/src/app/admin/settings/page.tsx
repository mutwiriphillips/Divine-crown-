import { desc } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireStaffPage } from "@/lib/auth/server";
import { mediaUrl } from "@/lib/media";
import { getSetting } from "@/lib/settings";
import { ActionForm, FieldError, SubmitButton } from "@/components/forms";
import { Field, PageHeader } from "@/components/ui";
import { saveBusinessAction } from "./actions";

export const metadata = { title: "Business & store" };

export default async function BusinessSettings() {
  await requireStaffPage("settings.business", "/admin/settings");
  const b = await getSetting("business");
  const assets = await db.select().from(schema.mediaAssets).orderBy(desc(schema.mediaAssets.createdAt)).limit(60);
  const faqs = [...b.faqs, { q: "", a: "" }, { q: "", a: "" }];
  return (
    <>
      <PageHeader title="Business & store" description="Your shop's name, contact details, home page wording and policies. Changes appear in the shop immediately." />
      <ActionForm action={saveBusinessAction} className="space-y-6">
        <section className="card grid gap-4 p-5 sm:grid-cols-2">
          <h2 className="text-lg sm:col-span-2">Business</h2>
          <Field label="Shop name" name="name"><input className="input" id="name" name="name" defaultValue={b.name} required /></Field>
          <Field label="Tagline" name="tagline"><input className="input" id="tagline" name="tagline" defaultValue={b.tagline} /></Field>
          <Field label="Phone" name="phone"><input className="input" id="phone" name="phone" defaultValue={b.phone} /></Field>
          <Field label="WhatsApp number" name="whatsapp"><input className="input" id="whatsapp" name="whatsapp" defaultValue={b.whatsapp ? `0${b.whatsapp.slice(3)}` : ""} placeholder="0712 345 678" /><FieldError name="whatsapp" /></Field>
          <Field label="Email" name="email"><input className="input" id="email" name="email" type="email" defaultValue={b.email} /></Field>
          <Field label="Opening hours" name="openingHours"><input className="input" id="openingHours" name="openingHours" defaultValue={b.openingHours} placeholder="Mon–Sat 8am–7pm" /></Field>
          <Field label="Street address" name="address"><input className="input" id="address" name="address" defaultValue={b.address} /></Field>
          <Field label="Town" name="town"><input className="input" id="town" name="town" defaultValue={b.town} /></Field>
          <Field label="KRA PIN" name="kraPin" hint="Printed on receipts and invoices when set."><input className="input" id="kraPin" name="kraPin" defaultValue={b.kraPin} /></Field>
          <Field label="Logo" name="logoAssetId" hint="Choose an uploaded image (add it in the image library first), or leave on the typeset name.">
            <select className="input" id="logoAssetId" name="logoAssetId" defaultValue={b.logoAssetId ?? ""}>
              <option value="">Use the shop name as the logo</option>
              {assets.map((a) => <option key={a.id} value={a.id}>{a.caption ?? a.originalName ?? a.id.slice(0, 8)}</option>)}
            </select>
            {b.logoAssetId ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={mediaUrl(b.logoAssetId, 320)} alt="Current logo" className="mt-2 h-12 w-auto" />
            ) : null}
          </Field>
          <Field label="Facebook page URL" name="facebook"><input className="input" id="facebook" name="facebook" defaultValue={b.social.facebook} placeholder="https://" /></Field>
          <Field label="Instagram URL" name="instagram"><input className="input" id="instagram" name="instagram" defaultValue={b.social.instagram} placeholder="https://" /></Field>
          <Field label="TikTok URL" name="tiktok"><input className="input" id="tiktok" name="tiktok" defaultValue={b.social.tiktok} placeholder="https://" /></Field>
        </section>
        <section className="card grid gap-4 p-5">
          <h2 className="text-lg">Home page</h2>
          <Field label="Announcement bar" name="announcement" hint="One line across the top of every page, e.g. delivery days. Leave empty to hide."><input className="input" id="announcement" name="announcement" defaultValue={b.announcement} /></Field>
          <Field label="Headline" name="heroHeadline"><input className="input" id="heroHeadline" name="heroHeadline" defaultValue={b.hero.headline} /></Field>
          <Field label="Introduction" name="heroIntro"><textarea className="input" id="heroIntro" name="heroIntro" defaultValue={b.hero.intro} /></Field>
          <fieldset>
            <legend className="field-label">Hero photos (up to 3)</legend>
            <p className="field-hint mb-2">Leave all unticked to use photos of your published products.</p>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
              {assets.map((a) => (
                <label key={a.id} className="relative cursor-pointer">
                  <input type="checkbox" name="heroImage" value={a.id} defaultChecked={b.hero.imageAssetIds.includes(a.id)} className="peer absolute left-1 top-1 z-10 h-4 w-4" />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={mediaUrl(a.id, 160)} alt={a.caption ?? a.originalName ?? "Library photo"} className="aspect-square w-full rounded-sm object-cover ring-plum peer-checked:ring-2" loading="lazy" />
                </label>
              ))}
            </div>
          </fieldset>
          <Field label="About section title" name="aboutTitle"><input className="input" id="aboutTitle" name="aboutTitle" defaultValue={b.about.title} /></Field>
          <Field label="About the shop" name="aboutBody" hint="Who you are and how you choose and store your products. Leave empty to hide the section."><textarea className="input min-h-[140px]" id="aboutBody" name="aboutBody" defaultValue={b.about.body} /></Field>
          <div>
            <p className="field-label">Frequently asked questions</p>
            <div className="space-y-2">
              {faqs.map((f, i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-[1fr_2fr]">
                  <input className="input input-sm" name="faqQ" defaultValue={f.q} placeholder="Question" aria-label={`Question ${i + 1}`} />
                  <input className="input input-sm" name="faqA" defaultValue={f.a} placeholder="Answer" aria-label={`Answer ${i + 1}`} />
                </div>
              ))}
            </div>
            <p className="field-hint">Save to get more empty rows. Clear both boxes to remove a question.</p>
          </div>
        </section>
        <section className="card grid gap-4 p-5">
          <h2 className="text-lg">Policies</h2>
          <p className="text-sm text-ink-soft">These appear in the shop footer and at checkout. Have them checked before going live — they form part of your terms with customers.</p>
          <Field label="Delivery" name="policyDelivery"><textarea className="input min-h-[100px]" id="policyDelivery" name="policyDelivery" defaultValue={b.policies.delivery} /></Field>
          <Field label="Returns & refunds" name="policyReturns"><textarea className="input min-h-[100px]" id="policyReturns" name="policyReturns" defaultValue={b.policies.returns} /></Field>
          <Field label="Privacy notice" name="policyPrivacy" hint="Explain what personal data you collect, why, who you share it with (e.g. couriers, M-Pesa), how long you keep it, and how customers can access or delete it."><textarea className="input min-h-[140px]" id="policyPrivacy" name="policyPrivacy" defaultValue={b.policies.privacy} /></Field>
          <Field label="Terms of sale" name="policyTerms"><textarea className="input min-h-[140px]" id="policyTerms" name="policyTerms" defaultValue={b.policies.terms} /></Field>
        </section>
        <SubmitButton>Save settings</SubmitButton>
      </ActionForm>
    </>
  );
}
