export function slugify(s: string) {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || "item"
  );
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
}

/** Show only the last 3 digits of a phone number to staff without contact permission. */
export function maskPhone(p: string | null | undefined) {
  if (!p) return "—";
  return p.length > 4 ? `••• ${p.slice(-3)}` : "•••";
}

export function maskEmail(e: string | null | undefined) {
  if (!e) return "—";
  const [u, d] = e.split("@");
  return `${u.slice(0, 1)}•••@${d ?? ""}`;
}

/** Kenyan number in any common format (0114…, +254114…, 254 114 …) → 254XXXXXXXXX for wa.me links. */
export function whatsappNumber(input: string | null | undefined) {
  const d = (input ?? "").replace(/\D/g, "");
  if (/^0[17]\d{8}$/.test(d)) return `254${d.slice(1)}`;
  if (/^[17]\d{8}$/.test(d)) return `254${d}`;
  return d;
}

/** Direct WhatsApp chat link with an optional pre-filled message. */
export function whatsappUrl(number: string | null | undefined, text?: string) {
  const n = whatsappNumber(number);
  if (!n) return null;
  return `https://wa.me/${n}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}
