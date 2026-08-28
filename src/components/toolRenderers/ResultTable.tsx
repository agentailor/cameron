"use client";
import { AlertTriangle } from "lucide-react";

/**
 * Tabular tool results. Handles the three payload shapes the read tools return:
 *   run_sql            { columns, rows, rowCount, truncated, note? }
 *   query_transactions { returned, matched, truncated, transactions, note?, hint? }
 *   inspect_csv        { headers, sampleRows, totalRows }
 *   list_categories    — a bare array, or one under `categories`
 *
 * `note`/`hint` are rendered as a callout rather than folded into the data: they are what stop a
 * capped page being read as a complete total, and an all-NULL aggregate being read as a zero.
 */

type Row = Record<string, unknown>;

interface Payload {
  columns?: string[];
  rows?: Row[];
  rowCount?: number;
  transactions?: Row[];
  categories?: Row[];
  sampleRows?: Row[];
  headers?: string[];
  totalRows?: number;
  returned?: number;
  matched?: number;
  truncated?: boolean;
  note?: string;
  hint?: string;
  error?: string;
}

/** Every array key a read tool puts its rows under. An unknown shape falls through to JSON. */
const ROW_KEYS = ["rows", "transactions", "categories", "sampleRows", "items"] as const;

function pickRows(p: Payload): Row[] {
  for (const k of ROW_KEYS) {
    const v = (p as Record<string, unknown>)[k];
    if (Array.isArray(v)) return v as Row[];
  }
  return [];
}

/** Postgres `numeric` arrives as a string ("455.0500000000000000"), so test the text too. */
const NUMERIC = /^-?\d+(\.\d+)?$/;
const isNumeric = (v: unknown) =>
  typeof v === "number" || typeof v === "bigint" || (typeof v === "string" && NUMERIC.test(v));

function display(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "object") return JSON.stringify(v);
  // Trim the trailing zeros `numeric` pads onto every scaled value.
  if (typeof v === "string" && NUMERIC.test(v) && v.includes(".")) {
    return v.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  }
  return String(v);
}

export const ResultTable = ({ payload }: { payload: Payload }) => {
  const rows = pickRows(payload);
  const declared = payload.columns ?? payload.headers;
  const columns =
    declared && declared.length > 0 ? declared : rows.length > 0 ? Object.keys(rows[0]) : [];

  const note = payload.note ?? payload.hint;
  const shown = rows.length;
  const total = payload.matched ?? payload.rowCount ?? payload.totalRows ?? shown;

  return (
    <div className="space-y-2">
      {columns.length > 0 && (
        <div className="border-inset-border overflow-hidden rounded-lg border">
          <div className="bg-inset-chrome border-inset-border flex items-center gap-3 border-b px-3 py-2">
            <span className="text-inset-muted font-mono text-[10.5px]">
              {shown === total
                ? `${shown} rows`
                : payload.sampleRows
                  ? `${shown} sample rows of ${total}`
                  : `${shown} of ${total} rows`}
            </span>
            {payload.truncated && (
              <span className="text-brand-bright bg-brand/15 rounded px-1.5 py-0.5 font-mono text-[10px] tracking-wider">
                PARTIAL
              </span>
            )}
          </div>

          <div className="bg-inset max-h-96 overflow-auto">
            <table className="w-full border-collapse font-mono text-[12.5px]">
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th
                      key={c}
                      className="text-inset-muted border-inset-border sticky top-0 border-b px-4 py-2 text-left text-[10px] font-normal tracking-widest uppercase"
                      style={{ backgroundColor: "var(--inset-chrome)" }}
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className={i % 2 ? "bg-white/2" : undefined}>
                    {columns.map((c) => {
                      const v = r[c];
                      const nul = v === null || v === undefined;
                      return (
                        <td
                          key={c}
                          className={`px-4 py-1.5 ${isNumeric(v) ? "text-right" : ""} ${
                            nul ? "text-inset-muted italic" : "text-inset-foreground"
                          }`}
                        >
                          {display(v)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {rows.length === 0 && !payload.error && (
        <div className="border-border text-muted-foreground rounded-lg border border-dashed px-4 py-3 font-mono text-xs">
          No rows returned.
        </div>
      )}

      {note && (
        <div className="border-brand/40 bg-brand/6 flex gap-2.5 rounded-lg border px-3.5 py-3">
          <AlertTriangle className="text-brand-dim mt-px h-4 w-4 shrink-0" />
          <div className="space-y-1">
            <div className="text-brand-dim font-mono text-[10px] tracking-[0.13em]">
              NOTE RETURNED TO THE AGENT
            </div>
            <div className="text-foreground/80 text-[13px] leading-relaxed">{note}</div>
          </div>
        </div>
      )}
    </div>
  );
};
