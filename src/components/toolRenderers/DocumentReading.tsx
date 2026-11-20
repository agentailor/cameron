"use client";
import { FileText } from "lucide-react";

/**
 * What `read_document` read. A field the reader could not make out says so in words: a bare
 * dash would look like "not on the receipt", which is a different fact.
 */

interface Fields {
  merchant?: string | null;
  date?: string | null;
  total?: number | null;
  subtotal?: number | null;
  tax?: number | null;
  tip?: number | null;
  currency?: string | null;
  unreadable?: string[];
}

export interface ReadingPayload {
  kind?: string;
  summary?: string;
  fields?: Fields;
  text?: string;
  truncated?: boolean;
  answer?: string;
  [k: string]: unknown;
}

const ORDER = ["merchant", "date", "total", "subtotal", "tax", "tip", "currency"] as const;
const AMOUNTS = new Set(["total", "subtotal", "tax", "tip"]);

function amount(v: number, currency: string | null | undefined): string {
  if (!currency) return v.toFixed(2);
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(v);
  } catch {
    return `${v.toFixed(2)} ${currency}`;
  }
}

export const DocumentReading = ({ payload }: { payload: ReadingPayload }) => {
  const fields = payload.fields;
  const unreadable = new Set(fields?.unreadable ?? []);

  return (
    <div className="border-border bg-card overflow-hidden rounded-lg border">
      <div className="border-border bg-muted/40 flex items-center gap-2 border-b px-3.5 py-2">
        <FileText className="text-muted-foreground h-3.5 w-3.5" />
        <span className="text-muted-foreground font-mono text-[10px] tracking-[0.13em] uppercase">
          {payload.kind ?? "document"}
        </span>
        {payload.summary && (
          <span className="text-foreground/80 truncate text-[13px]">{payload.summary}</span>
        )}
      </div>

      {payload.answer && (
        <div className="border-border border-b px-3.5 py-3 text-[13px] leading-relaxed">
          {payload.answer}
        </div>
      )}

      {fields && (
        <div className="grid grid-cols-2 gap-x-6 gap-y-3.5 px-4 py-3.5">
          {ORDER.map((k) => {
            const v = fields[k];
            if (!unreadable.has(k) && (v === null || v === undefined)) return null;
            return (
              <div key={k} className="flex flex-col gap-1">
                <span className="text-muted-foreground font-mono text-[10px] tracking-[0.12em] uppercase">
                  {k}
                </span>
                {unreadable.has(k) ? (
                  <span className="text-destructive text-sm">unreadable</span>
                ) : (
                  <span className="text-foreground font-mono text-sm">
                    {AMOUNTS.has(k) && typeof v === "number"
                      ? amount(v, fields.currency)
                      : String(v)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {payload.text && (
        <details className="border-border border-t">
          <summary className="text-muted-foreground cursor-pointer px-3.5 py-2 font-mono text-[10px] tracking-[0.13em]">
            TRANSCRIPTION{payload.truncated ? " (CUT SHORT)" : ""}
          </summary>
          <pre className="text-foreground/80 max-h-72 overflow-auto px-3.5 pb-3 font-mono text-xs whitespace-pre-wrap">
            {payload.text}
          </pre>
        </details>
      )}
    </div>
  );
};
