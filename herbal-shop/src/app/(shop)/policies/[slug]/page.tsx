import { notFound } from "next/navigation";
import { getSetting } from "@/lib/settings";

const TITLES: Record<string, string> = { delivery: "Delivery", returns: "Returns & refunds", privacy: "Privacy notice", terms: "Terms of sale" };

export default async function PolicyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!TITLES[slug]) notFound();
  const b = await getSetting("business");
  const text = b.policies[slug as keyof typeof b.policies];
  return (
    <article className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="mb-6 text-4xl">{TITLES[slug]}</h1>
      {text ? (
        <div className="prose-shop text-[17px] leading-relaxed">
          {text.split(/\n{2,}/).map((p, i) => (
            <p key={i} className="whitespace-pre-line">{p}</p>
          ))}
        </div>
      ) : (
        <p className="text-ink-soft">This policy hasn&apos;t been published yet. Contact the shop with any questions.</p>
      )}
    </article>
  );
}
