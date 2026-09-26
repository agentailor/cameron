"use client";

import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import {
  draftFromInput,
  validateDraft,
  type ParsedEntry,
  type ServerInput,
} from "@/lib/mcp/configParse";
import { chip, primaryButton, secondaryButton } from "./styles";

interface BatchReviewProps {
  entries: ParsedEntry[];
  existingNames: string[];
  onSave: (input: ServerInput) => Promise<void>;
  onDone: (added: number) => void;
  onBack: () => void;
}

type Outcome = { status: "added" } | { status: "failed"; message: string };

/**
 * A multi-server paste, reviewed before anything is saved. Servers are added one at a time and
 * each reports its own outcome, so a failure part-way leaves a visible, resumable list.
 */
export function BatchReview({ entries, existingNames, onSave, onDone, onBack }: BatchReviewProps) {
  const problemOf = (entry: ParsedEntry): string | null => {
    if ("error" in entry) return entry.error;
    const errors = validateDraft(draftFromInput(entry.input), existingNames);
    return Object.values(errors)[0] ?? null;
  };

  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(entries.filter((e) => !problemOf(e)).map((e) => e.name)),
  );
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const addedCount = Object.values(outcomes).filter((o) => o.status === "added").length;
  const toAdd = entries.filter(
    (e): e is Extract<ParsedEntry, { input: ServerInput }> =>
      "input" in e && selected.has(e.name) && outcomes[e.name]?.status !== "added" && !problemOf(e),
  );

  const toggle = (name: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const addAll = async () => {
    let added = addedCount;
    let failed = false;
    for (const entry of toAdd) {
      setSaving(entry.name);
      try {
        await onSave(entry.input);
        added++;
        setOutcomes((prev) => ({ ...prev, [entry.name]: { status: "added" } }));
      } catch (error) {
        failed = true;
        const message = error instanceof Error ? error.message : "Failed to save";
        setOutcomes((prev) => ({ ...prev, [entry.name]: { status: "failed", message } }));
      }
    }
    setSaving(null);
    if (!failed) onDone(added);
  };

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        The paste holds {entries.length} servers. Choose which to add.
      </p>

      <ul className="border-border divide-border divide-y rounded-lg border">
        {entries.map((entry) => {
          const outcome = outcomes[entry.name];
          const added = outcome?.status === "added";
          // Once added, the name is taken by this very server; don't flag it.
          const problem = added ? null : problemOf(entry);
          const input = "input" in entry ? entry.input : null;
          const disabled = !!problem || added || saving !== null;

          return (
            <li key={entry.name} className="flex items-start gap-3 px-3 py-2.5">
              <input
                type="checkbox"
                checked={added || (!problem && selected.has(entry.name))}
                disabled={disabled}
                onChange={() => toggle(entry.name)}
                aria-label={`Add ${entry.name || "unnamed server"}`}
                className="accent-foreground mt-1 h-3.5 w-3.5 cursor-pointer disabled:cursor-default"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-foreground font-mono text-sm">
                    {entry.name || "(no name)"}
                  </span>
                  {input && <span className={chip}>{input.type}</span>}
                  {saving === entry.name && (
                    <Loader2 className="text-muted-foreground h-3.5 w-3.5 animate-spin" />
                  )}
                  {added && (
                    <span className="text-muted-foreground inline-flex items-center gap-1 font-mono text-[11px]">
                      <Check className="text-term-green h-3.5 w-3.5" />
                      added
                    </span>
                  )}
                </div>
                {input && (
                  <p className="text-muted-foreground truncate font-mono text-xs">
                    {input.type === "stdio" ? [input.command, ...input.args].join(" ") : input.url}
                  </p>
                )}
                {problem && <p className="text-destructive mt-0.5 text-xs">{problem}</p>}
                {outcome?.status === "failed" && (
                  <p className="text-destructive mt-0.5 text-xs">{outcome.message}</p>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={addAll}
          disabled={!toAdd.length || saving !== null}
          className={primaryButton}
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {toAdd.length === 1 ? "Add 1 server" : `Add ${toAdd.length} servers`}
        </button>
        <button
          type="button"
          onClick={addedCount ? () => onDone(addedCount) : onBack}
          disabled={saving !== null}
          className={secondaryButton}
        >
          {addedCount ? "Done" : "Back"}
        </button>
      </div>
    </div>
  );
}
