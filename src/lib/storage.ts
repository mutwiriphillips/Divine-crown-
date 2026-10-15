import { mkdir, readFile, writeFile, unlink, stat } from "node:fs/promises";
import path from "node:path";
import { GetObjectCommand, PutObjectCommand, DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";

/**
 * File storage adapter.
 *  STORAGE_DRIVER=local (default)  files under STORAGE_DIR (default ./storage). Fine for a single server.
 *  STORAGE_DRIVER=s3               any S3-compatible bucket (AWS S3, Cloudflare R2, DigitalOcean Spaces).
 *                                  S3_BUCKET_PUBLIC holds product images; S3_BUCKET_PRIVATE holds expense
 *                                  attachments and is only read through authorised routes.
 */

type Visibility = "public" | "private";

interface Driver {
  put(key: string, body: Buffer, contentType: string, visibility: Visibility): Promise<void>;
  get(key: string, visibility: Visibility): Promise<Buffer | null>;
  remove(key: string, visibility: Visibility): Promise<void>;
}

function safeKey(key: string) {
  if (!/^[a-zA-Z0-9/_\-.]+$/.test(key) || key.includes("..")) throw new Error("Invalid storage key");
  return key;
}

const localDriver: Driver = {
  async put(key, body, _ct, visibility) {
    const p = path.join(process.env.STORAGE_DIR ?? "storage", visibility, safeKey(key));
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, body);
  },
  async get(key, visibility) {
    try {
      const p = path.join(process.env.STORAGE_DIR ?? "storage", visibility, safeKey(key));
      await stat(p);
      return await readFile(p);
    } catch {
      return null;
    }
  },
  async remove(key, visibility) {
    try {
      await unlink(path.join(process.env.STORAGE_DIR ?? "storage", visibility, safeKey(key)));
    } catch {
      /* already gone */
    }
  },
};

let s3: S3Client | null = null;
function s3Client() {
  s3 ??= new S3Client({
    region: process.env.S3_REGION ?? "auto",
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: !!process.env.S3_ENDPOINT,
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID!, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY! },
  });
  return s3;
}
const bucket = (v: Visibility) => (v === "public" ? process.env.S3_BUCKET_PUBLIC! : process.env.S3_BUCKET_PRIVATE!);

const s3Driver: Driver = {
  async put(key, body, contentType, visibility) {
    await s3Client().send(new PutObjectCommand({ Bucket: bucket(visibility), Key: safeKey(key), Body: body, ContentType: contentType }));
  },
  async get(key, visibility) {
    try {
      const r = await s3Client().send(new GetObjectCommand({ Bucket: bucket(visibility), Key: safeKey(key) }));
      return Buffer.from(await r.Body!.transformToByteArray());
    } catch {
      return null;
    }
  },
  async remove(key, visibility) {
    await s3Client().send(new DeleteObjectCommand({ Bucket: bucket(visibility), Key: safeKey(key) }));
  },
};

export const storage: Driver = process.env.STORAGE_DRIVER === "s3" ? s3Driver : localDriver;

const MAGIC: { mime: string; ext: string; test: (b: Buffer) => boolean }[] = [
  { mime: "image/jpeg", ext: "jpg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/png", ext: "png", test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: "image/webp", ext: "webp", test: (b) => b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP" },
  { mime: "application/pdf", ext: "pdf", test: (b) => b.subarray(0, 5).toString() === "%PDF-" },
];

/** Identify a file by its content, not its name or the browser's claim. */
export function sniffType(buf: Buffer): { mime: string; ext: string } | null {
  return MAGIC.find((m) => m.test(buf)) ?? null;
}

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
