import { sql } from "drizzle-orm";
import type { Executor } from "@/db";

const DEFAULT_PREFIX: Record<string, string> = {
  ORDER: "ORD-",
  RECEIPT: "RCT-",
  INVOICE: "INV-",
  CREDIT_NOTE: "CRN-",
  PO: "PO-",
  GRN: "GRN-",
  TICKET: "TKT-",
};

/**
 * Next sequential number for a document type. The UPDATE ... RETURNING takes a row lock,
 * so concurrent transactions get distinct, gap-free numbers (a rolled-back transaction
 * also rolls back its increment).
 */
export async function nextNumber(exec: Executor, key: keyof typeof DEFAULT_PREFIX | string, pad = 6): Promise<string> {
  const prefix = DEFAULT_PREFIX[key] ?? `${key}-`;
  await exec.execute(sql`insert into document_sequences (key, prefix, next) values (${key}, ${prefix}, 1) on conflict (key) do nothing`);
  const res = await exec.execute<{ prefix: string; n: number }>(
    sql`update document_sequences set next = next + 1 where key = ${key} returning prefix, next - 1 as n`,
  );
  const row = res.rows[0];
  return `${row.prefix}${String(row.n).padStart(pad, "0")}`;
}
