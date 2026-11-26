"use client";
import { useState } from "react";
import { field, fieldLabel } from "@/components/ui/formStyles";

export type LimitField = "maxConcurrentRuns" | "timeoutMinutes" | "maxRetries";

/** A limit's input: empty means "use the value below it", shown as the placeholder. */
export interface LimitInput {
  field: LimitField;
  label: string;
  /** What applies when the input is empty. */
  inherited: string;
}

export type Drafts = Partial<Record<LimitField, string>>;

/**
 * What to send for each field: empty clears it (null). Anything else goes as typed, a number
 * when it is one, so the server's validation is the only one and its message is what you see.
 */
export function toRequest(
  fields: LimitField[],
  drafts: Drafts,
): Partial<Record<LimitField, number | string | null>> {
  return Object.fromEntries(
    fields.map((f) => {
      const raw = (drafts[f] ?? "").trim();
      if (raw === "") return [f, null];
      const n = Number(raw);
      return [f, Number.isFinite(n) ? n : raw];
    }),
  );
}

export function useDrafts(initial: Partial<Record<LimitField, number | null>>) {
  const [drafts, setDrafts] = useState<Drafts>(() =>
    Object.fromEntries(Object.entries(initial).map(([k, n]) => [k, n === null ? "" : String(n)])),
  );
  return {
    drafts,
    set: (f: LimitField, value: string) => setDrafts((d) => ({ ...d, [f]: value })),
  };
}

export const LimitInputs = ({
  inputs,
  drafts,
  onChange,
  idPrefix,
}: {
  inputs: LimitInput[];
  drafts: Drafts;
  onChange: (field: LimitField, value: string) => void;
  idPrefix: string;
}) => (
  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
    {inputs.map(({ field: f, label, inherited }) => (
      <div key={f} className="space-y-1.5">
        <label htmlFor={`${idPrefix}-${f}`} className={fieldLabel}>
          {label.toUpperCase()}
        </label>
        <input
          id={`${idPrefix}-${f}`}
          type="text"
          inputMode="numeric"
          value={drafts[f] ?? ""}
          placeholder={inherited}
          onChange={(e) => onChange(f, e.target.value)}
          className={field}
        />
      </div>
    ))}
  </div>
);
