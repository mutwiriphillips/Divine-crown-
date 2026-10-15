import Link from "next/link";
import type { CardProduct } from "@/lib/catalog";
import { mediaUrl } from "@/lib/media";
import { formatKES } from "@/lib/money";
import { Stars } from "./stars";

export function ProductCard({ p, priority }: { p: CardProduct; priority?: boolean }) {
  return (
    <Link href={`/products/${p.slug}`} className="group block">
      <div className="relative aspect-[4/5] overflow-hidden rounded-sm bg-ivory-200">
        {p.imageAssetId ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={mediaUrl(p.imageAssetId, 480, p.crop)}
            srcSet={`${mediaUrl(p.imageAssetId, 320, p.crop)} 320w, ${mediaUrl(p.imageAssetId, 480, p.crop)} 480w, ${mediaUrl(p.imageAssetId, 640, p.crop)} 640w`}
            sizes="(min-width: 1024px) 22vw, (min-width: 640px) 30vw, 46vw"
            alt=""
            loading={priority ? "eager" : "lazy"}
            className="h-full w-full object-contain p-3 transition-transform duration-300 group-hover:scale-[1.02]"
          />
        ) : (
          <span className="grid h-full place-items-center text-sm text-ink-faint">Photo coming soon</span>
        )}
        {p.available <= 0 ? <span className="absolute left-2 top-2 rounded-sm bg-ivory-50/90 px-2 py-0.5 text-[12px] font-semibold text-ink-soft">Out of stock</span> : null}
      </div>
      <div className="pt-3">
        {p.brand ? <p className="text-[13px] text-ink-soft">{p.brand}</p> : null}
        <h3 className="font-serif text-[17px] leading-snug text-plum group-hover:underline group-hover:decoration-plum/30 group-hover:underline-offset-4">{p.name}</h3>
        <p className="mt-1 flex items-baseline gap-2">
          <span className="font-semibold tabular-nums">{formatKES(p.minPriceCents)}</span>
          {p.compareAtCents && p.compareAtCents > p.minPriceCents ? <s className="text-sm text-ink-faint tabular-nums">{formatKES(p.compareAtCents)}</s> : null}
        </p>
        {p.ratingCount > 0 && p.rating ? (
          <p className="mt-1 flex items-center gap-1 text-[13px] text-ink-soft">
            <Stars value={p.rating} /> <span>({p.ratingCount})</span>
          </p>
        ) : null}
      </div>
    </Link>
  );
}

export function ProductGrid({ items }: { items: CardProduct[] }) {
  return (
    <ul className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((p, i) => (
        <li key={p.id}>
          <ProductCard p={p} priority={i < 4} />
        </li>
      ))}
    </ul>
  );
}
