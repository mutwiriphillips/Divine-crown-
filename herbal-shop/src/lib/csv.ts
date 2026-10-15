import Papa from "papaparse";

/** Neutralise spreadsheet formula injection in exported cells. */
function safeCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = v instanceof Date ? v.toISOString() : String(v);
  return /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
}

export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  const cols = columns ?? (rows[0] ? Object.keys(rows[0]) : []);
  return Papa.unparse({ fields: cols, data: rows.map((r) => cols.map((c) => safeCell(r[c]))) });
}

export function csvResponse(filename: string, csv: string) {
  return new Response("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename.replace(/[^\w.-]/g, "_")}"`,
      "Cache-Control": "no-store",
    },
  });
}

export function parseCsv(text: string): { rows: Record<string, string>[]; errors: string[] } {
  const r = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), { header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim().toLowerCase() });
  return { rows: r.data, errors: r.errors.slice(0, 10).map((e) => `Row ${(e.row ?? 0) + 2}: ${e.message}`) };
}
