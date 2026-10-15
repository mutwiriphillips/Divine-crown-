import { renderVariant } from "@/lib/media";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Not found", { status: 404 });
  const url = new URL(req.url);
  const w = Number(url.searchParams.get("w") ?? 640);
  const c = url.searchParams.get("c");
  let crop = null;
  if (c) {
    const parts = c.split(",").map(Number);
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n) && n >= 0 && n <= 1)) crop = { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
  }
  const buf = await renderVariant(id, w, crop);
  if (!buf) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(buf), {
    headers: { "Content-Type": "image/webp", "Cache-Control": "public, max-age=31536000, immutable" },
  });
}
