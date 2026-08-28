"use client";
import { Check, X } from "lucide-react";

/**
 * What a mutating tool actually wrote. The tools echo RESOLVED values (not the agent's inputs),
 * so this is the record of what landed in the database — worth showing plainly after an approval.
 */

interface Payload {
  ok?: boolean;
  error?: string;
  id?: string;
  amount?: number;
  currency?: string;
  type?: string;
  note?: string;
  category?: string;
  merchant?: string;
  occurredAt?: string;
  name?: string;
  imported?: number;
  skippedBadDate?: number;
  skippedDuplicate?: number;
  [k: string]: unknown;
}

const SKIP = new Set(["ok", "error", "id"]);

const fmt = (k: string, v: unknown, currency?: string): string => {
  if (v === null || v === undefined) return "—";
  if (k === "amount" && typeof v === "number") {
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: currency ?? "USD",
      }).format(v);
    } catch {
      return `${v.toFixed(2)} ${currency ?? "USD"}`;
    }
  }
  if (k === "occurredAt" && typeof v === "string") {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d.toLocaleDateString();
  }
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
};

export const Receipt = ({ payload }: { payload: Payload }) => {
  if (payload.error) {
    return (
      <div className="border-destructive/40 bg-destructive/6 flex gap-2.5 rounded-lg border px-3.5 py-3">
        <X className="text-destructive mt-px h-4 w-4 shrink-0" />
        <div className="space-y-0.5">
          <div className="text-destructive font-mono text-[10px] tracking-[0.13em]">
            NOT WRITTEN
          </div>
          <div className="text-foreground/80 text-[13px] leading-relaxed">{payload.error}</div>
        </div>
      </div>
    );
  }

  const entries = Object.entries(payload).filter(
    ([k, v]) => !SKIP.has(k) && v !== undefined && v !== null && v !== "",
  );
  const currency = typeof payload.currency === "string" ? payload.currency : undefined;

  return (
    <div className="border-border bg-card overflow-hidden rounded-lg border">
      <div className="border-border bg-muted/40 flex items-center gap-2 border-b px-3.5 py-2">
        <Check className="text-brand-dim h-3.5 w-3.5" />
        <span className="text-muted-foreground font-mono text-[10px] tracking-[0.13em]">
          WRITTEN
        </span>
        {payload.id && (
          <span className="text-muted-foreground ml-auto font-mono text-[10px]">
            {String(payload.id).slice(0, 8)}
          </span>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 px-4 py-3.5">
        {entries.map(([k, v]) => (
          <div key={k} className="flex flex-col gap-1">
            <dt className="text-muted-foreground font-mono text-[10px] tracking-[0.12em]">
              {k.replace(/([A-Z])/g, " $1").toUpperCase()}
            </dt>
            <dd className="text-foreground text-sm break-words">{fmt(k, v, currency)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
};
