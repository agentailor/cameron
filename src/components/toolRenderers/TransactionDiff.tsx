"use client";
import type { TransactionView } from "@/types/finance";
import { TRANSACTION_VIEW_FIELDS } from "@/lib/finance/transactionView";

/**
 * Field-by-field before → after for one transaction. Drawn on the approval card for
 * `update_transaction` (before = the ledger's row, fetched live) and on its receipt (both from the
 * result). An overwrite approved without seeing what it replaces is the defect this exists for.
 */

const LABELS: Record<string, string> = { occurredAt: "DATE" };
const label = (k: string) => LABELS[k] ?? k.toUpperCase();

function display(field: string, v: unknown, currency: string): string {
  if (v === null || v === undefined || v === "") return "—";
  if (field === "amount" && typeof v === "number") {
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(v);
    } catch {
      return `${v.toFixed(2)} ${currency}`;
    }
  }
  if (field === "occurredAt" && typeof v === "string") {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d.toLocaleString();
  }
  return String(v);
}

export const TransactionDiff = ({
  before,
  after,
}: {
  before: TransactionView;
  after: TransactionView;
}) => (
  <div className="border-border bg-background overflow-hidden rounded-md border">
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="text-muted-foreground font-mono text-[10px] tracking-[0.12em]">
          <th className="px-4 py-2 text-left font-normal">FIELD</th>
          <th className="px-4 py-2 text-left font-normal">NOW</th>
          <th className="px-4 py-2 text-left font-normal">AFTER</th>
        </tr>
      </thead>
      <tbody>
        {TRANSACTION_VIEW_FIELDS.map((f) => {
          const changed = before[f] !== after[f];
          return (
            <tr key={f} className={changed ? "bg-muted/60" : undefined}>
              <td className="text-muted-foreground px-4 py-1.5 font-mono text-[10px] tracking-[0.12em]">
                {label(f)}
              </td>
              <td
                className={`px-4 py-1.5 wrap-break-word ${
                  changed ? "text-muted-foreground line-through" : "text-muted-foreground"
                }`}
              >
                {display(f, before[f], before.currency)}
              </td>
              <td
                className={`px-4 py-1.5 wrap-break-word ${
                  changed ? "text-foreground font-semibold" : "text-muted-foreground"
                }`}
              >
                {display(f, after[f], after.currency)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);

const isView = (v: unknown): v is TransactionView =>
  !!v && typeof v === "object" && typeof (v as TransactionView).id === "string";

/** True when a payload carries a renderable before/after pair. */
export function hasDiff(
  p: Record<string, unknown>,
): p is { before: TransactionView; after: TransactionView } {
  return isView(p.before) && isView(p.after);
}
