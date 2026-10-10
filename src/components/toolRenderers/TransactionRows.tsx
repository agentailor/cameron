"use client";
import { ResultTable } from "./ResultTable";

/**
 * The rows a delete would remove (its validation) or did remove (its result). The import warning
 * is the one note shown: the payload's `hint` is an instruction to the agent, not to the user.
 */

const COLUMNS = [
  "occurredAt",
  "amount",
  "currency",
  "type",
  "note",
  "category",
  "merchant",
  "account",
];

export const TransactionRows = ({ payload }: { payload: Record<string, unknown> }) => (
  <ResultTable
    payload={{
      columns: COLUMNS,
      transactions: Array.isArray(payload.transactions)
        ? (payload.transactions as Record<string, unknown>[])
        : [],
      note: typeof payload.reimportWarning === "string" ? payload.reimportWarning : undefined,
    }}
  />
);

/** No validation matches this call's arguments, so the server will refuse it. */
export const NotValidated = () => (
  <div className="border-destructive/40 bg-destructive/6 text-foreground/80 rounded-lg border px-3.5 py-3 text-[13px] leading-relaxed">
    This change was not validated with these exact arguments, so there is nothing to preview and it
    will be refused even if approved.
  </div>
);
