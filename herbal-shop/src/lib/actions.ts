import "server-only";
import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";
import { AuthError, ForbiddenError } from "@/lib/auth/core";
import { InsufficientStockError } from "@/lib/inventory";
import { OrderError, DuplicatePaymentError } from "@/lib/orders";
import { PaymentError } from "@/lib/payments/mpesa";
import { parseKESToCents } from "@/lib/money";

export type ActionState = {
  ok: boolean;
  message?: string;
  errors?: Record<string, string>;
  data?: Record<string, unknown>;
} | null;

export class UserError extends Error {
  constructor(
    message: string,
    public errors?: Record<string, string>,
  ) {
    super(message);
    this.name = "UserError";
  }
}

const KNOWN = [AuthError, ForbiddenError, OrderError, DuplicatePaymentError, PaymentError, UserError, InsufficientStockError];

/** Wrap a server action so expected failures become friendly messages and unexpected ones don't leak details. */
export function action(fn: (fd: FormData) => Promise<ActionState | void>) {
  return async (_prev: ActionState, fd: FormData): Promise<ActionState> => {
    try {
      const r = await fn(fd);
      return r ?? { ok: true, message: "Saved." };
    } catch (e) {
      unstable_rethrow(e);
      return toActionError(e);
    }
  };
}

export function toActionError(e: unknown): ActionState {
  if (e instanceof ZodError) {
    const errors: Record<string, string> = {};
    for (const i of e.issues) errors[i.path.join(".")] ??= i.message;
    return { ok: false, message: "Check the highlighted fields.", errors };
  }
  if (e instanceof UserError) return { ok: false, message: e.message, errors: e.errors };
  if (KNOWN.some((K) => e instanceof K)) return { ok: false, message: (e as Error).message };
  const pg = e as { code?: string; constraint?: string };
  if (pg?.code === "23505") return { ok: false, message: "That value is already in use. Choose a different one." };
  if (pg?.code === "23514") return { ok: false, message: "That change would make a stock or money balance invalid, so it wasn't saved." };
  console.error(e);
  return { ok: false, message: "Something went wrong and nothing was saved. Try again, and if it keeps happening, note the time and contact support." };
}

// ── FormData helpers ──

export function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}
export function optStr(fd: FormData, key: string): string | null {
  const v = str(fd, key);
  return v === "" ? null : v;
}
export function bool(fd: FormData, key: string): boolean {
  const v = fd.get(key);
  return v === "on" || v === "true" || v === "1";
}
export function int(fd: FormData, key: string, label = key): number {
  const v = str(fd, key);
  if (!/^-?\d+$/.test(v)) throw new UserError(`Enter a whole number for ${label}.`, { [key]: "Enter a whole number." });
  return Number(v);
}
export function optInt(fd: FormData, key: string, label = key): number | null {
  return str(fd, key) === "" ? null : int(fd, key, label);
}
export function moneyField(fd: FormData, key: string, label = key, opts: { required?: boolean; wholeShillings?: boolean } = {}): number | null {
  let cents: number | null;
  try {
    cents = parseKESToCents(str(fd, key));
  } catch {
    throw new UserError(`Enter a valid amount for ${label}.`, { [key]: "Enter an amount like 1250 or 1,250." });
  }
  if (cents === null) {
    if (opts.required) throw new UserError(`Enter ${label}.`, { [key]: "Required." });
    return null;
  }
  if (cents < 0) throw new UserError(`${label} can't be negative.`, { [key]: "Must be 0 or more." });
  if (opts.wholeShillings && cents % 100 !== 0) throw new UserError(`${label} must be whole shillings (M-Pesa can't take cents).`, { [key]: "Whole shillings only." });
  return cents;
}
export function dateField(fd: FormData, key: string): Date | null {
  const v = str(fd, key);
  if (!v) return null;
  const d = new Date(v.length === 10 ? `${v}T00:00:00+03:00` : v);
  if (Number.isNaN(d.getTime())) throw new UserError("Enter a valid date.", { [key]: "Invalid date." });
  return d;
}
