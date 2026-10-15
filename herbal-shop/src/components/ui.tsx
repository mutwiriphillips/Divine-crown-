import Link from "next/link";
import { formatKES } from "@/lib/money";

export function Money({ cents, className }: { cents: number | null | undefined; className?: string }) {
  return <span className={`tabular-nums ${className ?? ""}`}>{formatKES(cents)}</span>;
}

const TONES = {
  neutral: "bg-ivory-200 text-ink",
  plum: "bg-plum-50 text-plum",
  ok: "bg-ok-100 text-ok",
  warn: "bg-warn-100 text-warn",
  bad: "bg-bad-100 text-bad",
  clay: "bg-clay-100 text-clay-700",
} as const;
export type Tone = keyof typeof TONES;

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: React.ReactNode }) {
  return <span className={`inline-flex items-center rounded-sm px-2 py-0.5 text-[12px] font-semibold ${TONES[tone]}`}>{children}</span>;
}

export const ORDER_STATUS_TONE: Record<string, Tone> = {
  PENDING: "neutral",
  AWAITING_PAYMENT: "warn",
  PAID: "ok",
  PROCESSING: "plum",
  READY_FOR_COLLECTION: "plum",
  DISPATCHED: "plum",
  DELIVERED: "ok",
  COMPLETED: "ok",
  CANCELLED: "neutral",
  PARTIALLY_REFUNDED: "clay",
  REFUNDED: "clay",
  UNPAID: "warn",
  PARTIALLY_PAID: "warn",
  FAILED: "bad",
};

export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[28px]">{title}</h1>
        {description ? <p className="mt-1 max-w-prose text-ink-soft">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="card px-6 py-10 text-center">
      <p className="font-serif text-xl text-plum">{title}</p>
      {children ? <div className="mx-auto mt-2 max-w-md text-ink-soft">{children}</div> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Pagination({ page, pageSize, total, hrefFor }: { page: number; pageSize: number; total: number; hrefFor: (p: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <nav aria-label="Pages" className="mt-4 flex items-center justify-between gap-2 text-sm">
      <span className="text-ink-soft">
        Page {page} of {pages} · {total} total
      </span>
      <span className="flex gap-2">
        {page > 1 ? (
          <Link className="btn-secondary btn-sm" href={hrefFor(page - 1)}>
            Previous
          </Link>
        ) : null}
        {page < pages ? (
          <Link className="btn-secondary btn-sm" href={hrefFor(page + 1)}>
            Next
          </Link>
        ) : null}
      </span>
    </nav>
  );
}

export function Field({ label, name, hint, children }: { label: string; name?: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <label className="field-label" htmlFor={name}>
        {label}
      </label>
      {children}
      {hint ? <p className="field-hint">{hint}</p> : null}
    </div>
  );
}

export function NotImplemented({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded border border-dashed border-warn/50 bg-warn-100/60 px-3 py-2 text-sm text-warn">
      <strong>Not yet available:</strong> {children}
    </div>
  );
}

export function Notice({ tone = "warn", children }: { tone?: "warn" | "ok" | "bad" | "plum"; children: React.ReactNode }) {
  const cls = { warn: "bg-warn-100 text-warn", ok: "bg-ok-100 text-ok", bad: "bg-bad-100 text-bad", plum: "bg-plum-50 text-plum" }[tone];
  return <div className={`rounded px-3 py-2 text-sm ${cls}`}>{children}</div>;
}

export function fmtDate(d: Date | string | null | undefined, withTime = false) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString("en-KE", {
    timeZone: "Africa/Nairobi",
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}
