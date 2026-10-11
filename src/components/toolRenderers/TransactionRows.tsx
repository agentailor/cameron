"use client";
import { ResultTable } from "./ResultTable";

/**
 * The rows a delete would remove (its validation) or did remove (its result). The import warning
 * is the one note shown: the payload's `hint` is an instruction to the agent, not to the user.
 */

type Row = Record<string, unknown>;

const COLUMNS = ["date", "amount", "currency", "type", "note", "category", "merchant", "account"];

/** Dropped when no row has a value — an all-NULL column only pushes the others off-screen. */
const OPTIONAL = new Set(["merchant"]);

function localDate(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString();
}

export const TransactionRows = ({ payload }: { payload: Row }) => {
  const source = Array.isArray(payload.transactions) ? (payload.transactions as Row[]) : [];
  const rows: Row[] = source.map(({ occurredAt, ...rest }) => ({
    ...rest,
    date: localDate(occurredAt),
  }));
  const columns = COLUMNS.filter(
    (c) => !OPTIONAL.has(c) || rows.some((r) => r[c] !== null && r[c] !== undefined && r[c] !== ""),
  );
  return (
    <ResultTable
      payload={{
        columns,
        transactions: rows,
        note: typeof payload.reimportWarning === "string" ? payload.reimportWarning : undefined,
      }}
    />
  );
};

/** No validation matches this call's arguments, so the server will refuse it. */
export const NotValidated = () => (
  <div className="border-destructive/40 bg-destructive/6 text-foreground/80 rounded-lg border px-3.5 py-3 text-[13px] leading-relaxed">
    This change was not validated with these exact arguments, so there is nothing to preview and it
    will be refused even if approved.
  </div>
);
