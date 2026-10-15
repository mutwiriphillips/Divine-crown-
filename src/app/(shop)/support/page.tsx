import { whatsappUrl } from "@/lib/text";
import { getCurrentUser } from "@/lib/auth/server";
import { getSetting } from "@/lib/settings";
import { ActionForm, SubmitButton } from "@/components/forms";
import { supportRequestAction } from "../actions";

export const metadata = { title: "Contact us" };

const CATS = [
  ["QUESTION", "A question about a product"],
  ["DELIVERY_ISSUE", "Delivery or collection"],
  ["RETURN_REQUEST", "Return or refund request"],
  ["CANCELLATION_REQUEST", "Cancel an order"],
  ["COMPLAINT", "A complaint"],
  ["OTHER", "Something else"],
] as const;

export default async function SupportPage({ searchParams }: { searchParams: Promise<{ order?: string; category?: string }> }) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  const b = await getSetting("business");
  const wa = whatsappUrl(b.whatsapp, `Hello ${b.name}, I have a question.`);
  return (
    <div className="mx-auto grid max-w-5xl gap-10 px-4 py-10 md:grid-cols-[1fr_1.3fr]">
      <div>
        <h1 className="text-4xl">Contact us</h1>
        <p className="mt-3 text-ink-soft">Send us a message and we&apos;ll reply as soon as we can during opening hours.</p>
        <ul className="mt-6 space-y-2">
          {b.phone ? <li>Call: <a className="link" href={`tel:${b.phone}`}>{b.phone}</a></li> : null}
          {wa ? <li>WhatsApp: <a className="link" href={wa} target="_blank" rel="noopener">Message us{b.phone ? ` on ${b.phone}` : ""}</a></li> : null}
          {b.email ? <li>Email: <a className="link" href={`mailto:${b.email}`}>{b.email}</a></li> : null}
          {b.openingHours ? <li className="text-ink-soft">{b.openingHours}</li> : null}
        </ul>
      </div>
      <ActionForm action={supportRequestAction} className="card space-y-4 p-5" resetOnSuccess>
        <div>
          <label className="field-label" htmlFor="category">What is it about?</label>
          <select className="input" id="category" name="category" defaultValue={CATS.some(([k]) => k === sp.category) ? sp.category : "QUESTION"}>
            {CATS.map(([k, l]) => (
              <option key={k} value={k}>{l}</option>
            ))}
          </select>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="field-label" htmlFor="name">Your name</label>
            <input className="input" id="name" name="name" defaultValue={user?.name ?? ""} required />
          </div>
          <div>
            <label className="field-label" htmlFor="orderNumber">Order number <span className="font-normal text-ink-soft">(if any)</span></label>
            <input className="input uppercase" id="orderNumber" name="orderNumber" defaultValue={sp.order ?? ""} />
          </div>
          <div>
            <label className="field-label" htmlFor="phone">Phone</label>
            <input className="input" id="phone" name="phone" type="tel" defaultValue={user?.phone?.replace(/^254/, "0") ?? ""} />
          </div>
          <div>
            <label className="field-label" htmlFor="email">Email</label>
            <input className="input" id="email" name="email" type="email" defaultValue={user?.email ?? ""} />
          </div>
        </div>
        <div>
          <label className="field-label" htmlFor="subject">Subject</label>
          <input className="input" id="subject" name="subject" required />
        </div>
        <div>
          <label className="field-label" htmlFor="message">Message</label>
          <textarea className="input min-h-[140px]" id="message" name="message" required />
        </div>
        <SubmitButton>Send message</SubmitButton>
      </ActionForm>
    </div>
  );
}
