"use client";

import { useState } from "react";
import { Eye, EyeOff, Plus, X } from "lucide-react";
import { looksLikeJson, type KeyValue } from "@/lib/mcp/configParse";
import { field, iconButton, linkButton } from "./styles";

interface KeyValueEditorProps {
  id: string;
  rows: KeyValue[];
  onChange: (rows: KeyValue[]) => void;
  keyPlaceholder: string;
  addLabel: string;
}

const LINE = /^\s*(?:export\s+)?([^=:\s]+)\s*[=:]\s*(.*?)\s*$/;

/**
 * Name/value rows whose values are masked until revealed one at a time: they usually hold API
 * keys and tokens. Pasting `KEY=value` (or `Name: value`) lines into a name field fills rows.
 */
export function KeyValueEditor({
  id,
  rows,
  onChange,
  keyPlaceholder,
  addLabel,
}: KeyValueEditorProps) {
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [focusIndex, setFocusIndex] = useState<number | null>(null);

  const set = (index: number, patch: Partial<KeyValue>) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const remove = (index: number) => {
    setRevealed(new Set());
    onChange(rows.filter((_, i) => i !== index));
  };

  const toggle = (index: number) =>
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  const handlePaste = (index: number, e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    if (looksLikeJson(text)) return;
    const parsed = text
      .split(/\r?\n/)
      .filter((line) => line.trim() && !line.trim().startsWith("#"))
      .map((line) => line.match(LINE));
    if (!parsed.length || parsed.some((m) => !m)) return;
    e.preventDefault();
    const pasted = parsed.map((m) => ({ key: m![1], value: unquote(m![2]) }));
    onChange([...rows.slice(0, index), ...pasted, ...rows.slice(index + 1)]);
  };

  return (
    <div className="space-y-1.5">
      {rows.map((row, i) => (
        <div key={i} className="grid grid-cols-[2fr_3fr_auto_auto] items-center gap-1.5">
          <input
            id={i === 0 ? id : undefined}
            value={row.key}
            autoFocus={i === focusIndex}
            onChange={(e) => set(i, { key: e.target.value })}
            onPaste={(e) => handlePaste(i, e)}
            placeholder={keyPlaceholder}
            aria-label={`Name ${i + 1}`}
            className={`${field} font-mono`}
          />
          <input
            type={revealed.has(i) ? "text" : "password"}
            value={row.value}
            onChange={(e) => set(i, { value: e.target.value })}
            placeholder="value"
            aria-label={`Value ${i + 1}`}
            autoComplete="off"
            className={`${field} font-mono`}
          />
          <button
            type="button"
            onClick={() => toggle(i)}
            className={iconButton}
            aria-label={revealed.has(i) ? `Hide value ${i + 1}` : `Show value ${i + 1}`}
          >
            {revealed.has(i) ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={() => remove(i)}
            className={iconButton}
            aria-label={`Remove row ${i + 1}`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => {
          setFocusIndex(rows.length);
          onChange([...rows, { key: "", value: "" }]);
        }}
        className={linkButton}
      >
        <Plus className="h-3 w-3" />
        {addLabel}
      </button>
    </div>
  );
}

function unquote(value: string): string {
  const m = value.match(/^(["'])(.*)\1$/);
  return m ? m[2] : value;
}
