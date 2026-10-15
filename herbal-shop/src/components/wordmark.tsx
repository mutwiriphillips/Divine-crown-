import Link from "next/link";
import { mediaUrl } from "@/lib/media";

/** Typeset wordmark; replaced by the uploaded logo when one is set in Settings → Business. */
export function Wordmark({ name, logoAssetId, href = "/", size = "md" }: { name: string; logoAssetId?: string | null; href?: string; size?: "md" | "lg" }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2 text-plum" aria-label={`${name} home`}>
      {logoAssetId ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={mediaUrl(logoAssetId, 320)} alt={name} className={size === "lg" ? "h-14 w-auto" : "h-9 w-auto"} />
      ) : (
        <span className={`font-serif leading-none ${size === "lg" ? "text-[34px]" : "text-[24px]"}`}>{name}</span>
      )}
    </Link>
  );
}
