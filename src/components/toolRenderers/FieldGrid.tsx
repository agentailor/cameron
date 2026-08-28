"use client";

/**
 * Key/value view of a tool call's arguments. Used directly for `fields` / `filters` / `file` /
 * `csvPlan`, and — as `expense` — inside the approval gate, where the lead field is the amount.
 *
 * The gate's grid is per-tool by design: what deserves prominence when money is involved is the
 * amount, not the first key in the object.
 */

type Args = Record<string, unknown>;

const LABELS: Record<string, string> = {
  amount: "AMOUNT",
  amountMinor: "AMOUNT",
  category: "CATEGORY",
  merchant: "MERCHANT",
  occurredAt: "DATE",
  date: "DATE",
  note: "NOTE",
  description: "DESCRIPTION",
  type: "TYPE",
  currency: "CURRENCY",
  account: "ACCOUNT",
  name: "NAME",
  fileKey: "FILE",
  dateFormat: "DATE FORMAT",
  limit: "LIMIT",
  from: "FROM",
  to: "TO",
};

const label = (k: string) => LABELS[k] ?? k.replace(/([A-Z])/g, " $1").toUpperCase();

function display(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

const money = (v: unknown, currency?: unknown) => {
  const n = typeof v === "number" ? v : Number(v);
  if (Number.isNaN(n)) return display(v);
  const code = typeof currency === "string" ? currency : "USD";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: code }).format(n);
  } catch {
    return `${n.toFixed(2)} ${code}`;
  }
};

export const FieldGrid = ({ args, lead }: { args: Args; lead?: string }) => {
  const entries = Object.entries(args).filter(([, v]) => v !== undefined && v !== "");
  if (entries.length === 0) return null;

  const leadKey = lead && lead in args ? lead : undefined;
  const rest = entries.filter(([k]) => k !== leadKey);

  return (
    <div className="border-border bg-background grid grid-cols-2 gap-x-6 gap-y-3.5 rounded-md border px-4 py-3.5">
      {leadKey && (
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground font-mono text-[10px] tracking-[0.12em]">
            {label(leadKey)}
          </span>
          <span className="text-foreground font-mono text-xl font-semibold">
            {money(args[leadKey], args.currency)}
          </span>
        </div>
      )}
      {rest.map(([k, v]) => (
        <div key={k} className="flex flex-col gap-1">
          <span className="text-muted-foreground font-mono text-[10px] tracking-[0.12em]">
            {label(k)}
          </span>
          <span className="text-foreground text-sm wrap-break-word">{display(v)}</span>
        </div>
      ))}
    </div>
  );
};
