"use client";

import { useRef, useState } from "react";
import { ActionForm, SubmitButton } from "@/components/forms";
import type { ActionState } from "@/lib/actions";

type Rect = { x: number; y: number; w: number; h: number };

/** Drag on the photo to choose the crop. Saves fractions of the original; the photo itself is never altered. */
export function CropEditor({
  imageId,
  src,
  initial,
  action,
}: {
  imageId: string;
  src: string;
  initial: Rect | null;
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
}) {
  const [rect, setRect] = useState<Rect | null>(initial);
  const box = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);

  const pos = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };

  return (
    <div>
      <p className="mb-2 text-sm text-ink-soft">Drag across the photo to frame the product. The shop shows the framed area; the original photo is kept.</p>
      <div
        ref={box}
        className="relative inline-block max-w-full cursor-crosshair touch-none select-none"
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          start.current = pos(e);
          setRect({ ...start.current, w: 0, h: 0 });
        }}
        onPointerMove={(e) => {
          if (!start.current) return;
          const p = pos(e);
          const s = start.current;
          setRect({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) });
        }}
        onPointerUp={() => (start.current = null)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" className="block max-h-[420px] w-auto" draggable={false} />
        {rect && rect.w > 0 ? (
          <div
            className="pointer-events-none absolute border-2 border-raspberry"
            style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%`, boxShadow: "0 0 0 9999px rgba(43,36,39,.45)" }}
          />
        ) : null}
      </div>
      <ActionForm action={action} className="mt-3 flex flex-wrap gap-2">
        <input type="hidden" name="imageId" value={imageId} />
        <input type="hidden" name="op" value="crop" />
        <input type="hidden" name="cropX" value={rect?.x ?? ""} />
        <input type="hidden" name="cropY" value={rect?.y ?? ""} />
        <input type="hidden" name="cropW" value={rect?.w ?? ""} />
        <input type="hidden" name="cropH" value={rect?.h ?? ""} />
        <SubmitButton className="btn-primary btn-sm">Save framing</SubmitButton>
        <SubmitButton className="btn-secondary btn-sm" name="clear" value="1">Show whole photo</SubmitButton>
      </ActionForm>
    </div>
  );
}
