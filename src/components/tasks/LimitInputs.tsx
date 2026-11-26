"use client";
import { useState } from "react";
import { field, fieldLabel } from "@/components/ui/formStyles";
import { LIMIT_BOUNDS, parseLimit, type LimitField } from "@/lib/tasks/limits";

/** A limit's input: empty means "use the value below it", shown as the placeholder. */
export interface LimitInput {
  field: LimitField;
  label: string;
  /** What applies when the input is empty. */
  inherited: string;
}

export type Drafts = Partial<Record<LimitField, string>>;

/** Parse every draft; the first invalid one wins. Empty clears the field (null). */
export function parseDrafts(
  fields: LimitField[],
  drafts: Drafts,
): { ok: true; values: Partial<Record<LimitField, number | null>> } | { ok: false; error: string } {
  const values: Partial<Record<LimitField, number | null>> = {};
  for (const f of fields) {
    const parsed = parseLimit(f, (drafts[f] ?? "").trim());
    if (!parsed.ok) return { ok: false, error: parsed.error };
    values[f] = parsed.value;
  }
  return { ok: true, values };
}

export function useDrafts(initial: Partial<Record<LimitField, number | null>>) {
  const toDrafts = (v: typeof initial): Drafts =>
    Object.fromEntries(Object.entries(v).map(([k, n]) => [k, n === null ? "" : String(n)]));
  const [drafts, setDrafts] = useState<Drafts>(() => toDrafts(initial));
  return {
    drafts,
    set: (f: LimitField, value: string) => setDrafts((d) => ({ ...d, [f]: value })),
    reset: (v: typeof initial) => setDrafts(toDrafts(v)),
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
          type="number"
          inputMode="numeric"
          min={LIMIT_BOUNDS[f].min}
          max={LIMIT_BOUNDS[f].max}
          step={1}
          value={drafts[f] ?? ""}
          placeholder={inherited}
          onChange={(e) => onChange(f, e.target.value)}
          className={field}
        />
      </div>
    ))}
  </div>
);
