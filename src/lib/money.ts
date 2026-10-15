/**
 * Money helpers. All amounts are integer cents of KES.
 * Business rule: catalogue prices are whole shillings, and computed discounts/taxes added on top
 * are rounded to whole shillings, so every order total is payable through M-Pesa (whole KES only).
 */

export const CENTS = 100;

export function formatKES(cents: number | null | undefined, opts: { showZeroCents?: boolean } = {}): string {
  if (cents === null || cents === undefined) return "—";
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / CENTS);
  const frac = abs % CENTS;
  const wholeStr = whole.toLocaleString("en-KE");
  const fracStr = frac || opts.showZeroCents ? "." + String(frac).padStart(2, "0") : "";
  return `${negative ? "−" : ""}KES ${wholeStr}${fracStr}`;
}

/** Plain number for CSV exports, e.g. 1234.50 */
export function centsToDecimalString(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  return `${negative ? "-" : ""}${Math.floor(abs / CENTS)}.${String(abs % CENTS).padStart(2, "0")}`;
}

/**
 * Parse a user-entered shilling amount ("1,250", "1250.50") into cents without floating-point error.
 * Returns null for empty input; throws for malformed input.
 */
export function parseKESToCents(input: string | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  const s = String(input).trim().replace(/,/g, "").replace(/^KES\s*/i, "");
  if (s === "") return null;
  const m = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) throw new Error(`"${input}" is not a valid amount`);
  const whole = Number(m[2]);
  const frac = Number((m[3] ?? "").padEnd(2, "0") || "0");
  const cents = whole * CENTS + frac;
  if (!Number.isSafeInteger(cents)) throw new Error("Amount is too large");
  return m[1] ? -cents : cents;
}

export function isWholeShillings(cents: number): boolean {
  return cents % CENTS === 0;
}

/** Round to the nearest whole shilling (half up). */
export function roundToShilling(cents: number): number {
  return Math.round(cents / CENTS) * CENTS;
}

/** Floor to whole shillings (used for discounts so we never over-discount by rounding). */
export function floorToShilling(cents: number): number {
  return Math.floor(cents / CENTS) * CENTS;
}

/** Split `total` across `weights` proportionally so the parts always sum exactly to `total`. */
export function allocateProportionally(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0 || total === 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const floored = raw.map(Math.floor);
  let remainder = total - floored.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac);
  for (const { i } of order) {
    if (remainder <= 0) break;
    floored[i] += 1;
    remainder -= 1;
  }
  return floored;
}
