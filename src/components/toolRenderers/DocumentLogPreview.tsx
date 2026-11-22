"use client";
import { FileText } from "lucide-react";
import { fileUrl } from "@/lib/storage/fileUrl";

/**
 * The approval card for `log_from_document`: the document itself beside the values the agent
 * wants to write, and — when the thread holds its reading — where those values differ from what
 * the document says. The image is the evidence; the reading is a model's claim about it.
 */

type Args = Record<string, unknown>;

interface Fields {
  merchant?: string | null;
  date?: string | null;
  total?: number | null;
  currency?: string | null;
  unreadable?: string[];
}

const IMAGE = /\.(png|jpe?g)$/i;

function money(v: unknown, currency: unknown): string {
  if (typeof v !== "number") return "—";
  const code = typeof currency === "string" ? currency : undefined;
  if (!code) return v.toFixed(2);
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: code }).format(v);
  } catch {
    return `${v.toFixed(2)} ${code}`;
  }
}

/** What the document said about a field, or why it can't be compared. */
function fromDocument(fields: Fields | undefined, key: keyof Fields): string | null {
  if (!fields) return null;
  if (fields.unreadable?.includes(key)) return "unreadable on the document";
  const v = fields[key];
  if (v === null || v === undefined) return null;
  return key === "total" ? money(v, fields.currency) : String(v);
}

function Row({
  label,
  value,
  printed,
  differs,
}: {
  label: string;
  value: string;
  printed?: string | null;
  differs?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-muted-foreground font-mono text-[10px] tracking-[0.12em]">{label}</span>
      <span className="text-foreground text-sm wrap-break-word">{value}</span>
      {printed && (
        <span className={`text-xs ${differs ? "text-destructive" : "text-muted-foreground"}`}>
          {differs ? "document says " : "on document: "}
          {printed}
        </span>
      )}
    </div>
  );
}

export const DocumentLogPreview = ({
  args,
  reading,
}: {
  args: Args;
  reading?: Record<string, unknown> | null;
}) => {
  const fileKey = typeof args.fileKey === "string" ? args.fileKey : "";
  const fields = (reading?.fields ?? undefined) as Fields | undefined;
  const amount = typeof args.amount === "number" ? args.amount : NaN;

  const docTotal = fields?.total;
  const totalDiffers = typeof docTotal === "number" && Math.abs(docTotal - amount) >= 0.005;
  const docCurrency = fields?.currency;
  const currencyDiffers = !!docCurrency && docCurrency !== args.currency;

  return (
    <div className="border-border bg-background flex flex-col gap-4 rounded-md border px-4 py-3.5 sm:flex-row">
      {fileKey &&
        (IMAGE.test(fileKey) ? (
          <a href={fileUrl(fileKey)} target="_blank" rel="noreferrer" className="shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={fileUrl(fileKey)}
              alt="The document being logged"
              className="border-border max-h-64 w-full rounded border object-contain sm:w-44"
            />
          </a>
        ) : (
          <a
            href={fileUrl(fileKey)}
            target="_blank"
            rel="noreferrer"
            className="text-foreground flex shrink-0 items-center gap-2 text-sm hover:underline"
          >
            <FileText className="h-4 w-4" /> Open the document
          </a>
        ))}

      <div className="flex min-w-0 flex-1 flex-col gap-3.5">
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground font-mono text-[10px] tracking-[0.12em]">
            AMOUNT
          </span>
          <span className="text-foreground font-mono text-xl font-semibold">
            {money(amount, args.currency)}
          </span>
          {fields && (
            <span
              className={`text-xs ${totalDiffers || fields.unreadable?.includes("total") ? "text-destructive" : "text-muted-foreground"}`}
            >
              {totalDiffers ? "document says " : "on document: "}
              {fromDocument(fields, "total") ?? "no total printed"}
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3.5">
          <Row
            label="DATE"
            value={String(args.occurredAt ?? "—")}
            printed={fromDocument(fields, "date")}
          />
          <Row
            label="CURRENCY"
            value={String(args.currency ?? "—")}
            printed={fromDocument(fields, "currency")}
            differs={currencyDiffers}
          />
          <Row
            label="MERCHANT"
            value={String(args.merchant ?? "—")}
            printed={fromDocument(fields, "merchant")}
          />
          <Row label="ACCOUNT" value={String(args.account ?? "—")} />
          <Row label="CATEGORY" value={String(args.category ?? "—")} />
          <Row label="NOTE" value={String(args.note ?? "—")} />
        </div>
        {!fields && (
          <p className="text-muted-foreground text-xs">
            No reading of this document in the conversation — check the values against the document
            itself.
          </p>
        )}
      </div>
    </div>
  );
};
