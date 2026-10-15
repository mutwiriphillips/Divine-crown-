"use client";

import { useState } from "react";

export type GalleryImage = { src: string; large: string; thumb: string; alt: string };

export function Gallery({ images, name }: { images: GalleryImage[]; name: string }) {
  const [i, setI] = useState(0);
  if (!images.length) {
    return <div className="grid aspect-square place-items-center rounded-sm bg-ivory-200 text-ink-faint">Photo coming soon</div>;
  }
  const cur = images[Math.min(i, images.length - 1)];
  return (
    <div>
      <a href={cur.large} target="_blank" rel="noopener" className="block aspect-square overflow-hidden rounded-sm bg-ivory-200" aria-label="Open larger photo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={cur.src} alt={cur.alt || name} className="h-full w-full object-contain p-4" />
      </a>
      {images.length > 1 ? (
        <ul className="mt-3 flex gap-2 overflow-x-auto pb-1" aria-label="More photos">
          {images.map((im, idx) => (
            <li key={im.thumb} className="shrink-0">
              <button
                type="button"
                onClick={() => setI(idx)}
                aria-label={`Show photo ${idx + 1}`}
                aria-current={idx === i}
                className={`block h-20 w-20 overflow-hidden rounded-sm bg-ivory-200 ring-offset-2 ${idx === i ? "ring-2 ring-plum" : "opacity-80 hover:opacity-100"}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={im.thumb} alt="" className="h-full w-full object-cover" loading="lazy" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
