import sharp from "sharp";
import { eq } from "drizzle-orm";
import { db, schema, type Executor } from "@/db";
import { MAX_UPLOAD_BYTES, sniffType, storage } from "@/lib/storage";

export const ALLOWED_WIDTHS = [160, 320, 480, 640, 960, 1280, 1600];

/**
 * Store an uploaded image: verify it is really an image, apply EXIF rotation, strip metadata
 * (phone photos can carry GPS location), cap the size, and save as high-quality JPEG.
 */
export async function importImage(
  buf: Buffer,
  meta: { originalName?: string | null; sourceNote?: string | null; caption?: string | null },
  exec: Executor = db,
) {
  if (buf.length > MAX_UPLOAD_BYTES) throw new Error("Images must be 8 MB or smaller.");
  const type = sniffType(buf);
  if (!type || !type.mime.startsWith("image/")) throw new Error("Upload a JPEG, PNG or WebP image.");
  const img = sharp(buf, { failOn: "error" }).rotate();
  const out = await img
    .resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 86, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  const key = `products/${crypto.randomUUID()}.jpg`;
  await storage.put(key, out.data, "image/jpeg", "public");
  const [asset] = await exec
    .insert(schema.mediaAssets)
    .values({
      storageKey: key,
      originalName: meta.originalName ?? null,
      mime: "image/jpeg",
      width: out.info.width,
      height: out.info.height,
      sizeBytes: out.info.size,
      caption: meta.caption ?? null,
      sourceNote: meta.sourceNote ?? null,
    })
    .returning();
  return asset;
}

export type Crop = { x: number; y: number; w: number; h: number } | null;

export function mediaUrl(assetId: string, width = 640, crop?: Crop) {
  const w = ALLOWED_WIDTHS.find((x) => x >= width) ?? 1600;
  const c = crop && crop.w > 0 && crop.h > 0 ? `&c=${[crop.x, crop.y, crop.w, crop.h].map((n) => n.toFixed(4)).join(",")}` : "";
  return `/media/${assetId}?w=${w}${c}`;
}

export function imageCrop(img: { cropX: number | null; cropY: number | null; cropW: number | null; cropH: number | null }): Crop {
  return img.cropW && img.cropH ? { x: img.cropX ?? 0, y: img.cropY ?? 0, w: img.cropW, h: img.cropH } : null;
}

/** Render a resized (and optionally cropped) variant, cached in storage. */
export async function renderVariant(assetId: string, width: number, crop: Crop): Promise<Buffer | null> {
  const asset = await db.query.mediaAssets.findFirst({ where: eq(schema.mediaAssets.id, assetId) });
  if (!asset) return null;
  const w = ALLOWED_WIDTHS.includes(width) ? width : 640;
  if (crop) {
    // Only crops that were saved for this image are rendered, so arbitrary URLs can't fill the cache.
    const saved = await db.query.productImages.findMany({ where: eq(schema.productImages.assetId, asset.id) });
    const same = (a: number | null, b: number) => a != null && Math.abs(a - b) < 0.0002;
    const c = crop;
    if (!saved.some((s) => same(s.cropX ?? 0, c.x) && same(s.cropY ?? 0, c.y) && same(s.cropW, c.w) && same(s.cropH, c.h))) crop = null;
  }
  const cropKey = crop ? `-${[crop.x, crop.y, crop.w, crop.h].map((n) => Math.round(n * 10000)).join("_")}` : "";
  const cacheKey = `cache/${asset.id}-${w}${cropKey}.webp`;
  const cached = await storage.get(cacheKey, "public");
  if (cached) return cached;
  const original = await storage.get(asset.storageKey, "public");
  if (!original) return null;
  let pipeline = sharp(original);
  if (crop) {
    const left = Math.max(0, Math.round(crop.x * asset.width));
    const top = Math.max(0, Math.round(crop.y * asset.height));
    const width = Math.min(asset.width - left, Math.max(1, Math.round(crop.w * asset.width)));
    const height = Math.min(asset.height - top, Math.max(1, Math.round(crop.h * asset.height)));
    pipeline = pipeline.extract({ left, top, width, height });
  }
  const out = await pipeline.resize({ width: w, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
  await storage.put(cacheKey, out, "image/webp", "public");
  return out;
}
