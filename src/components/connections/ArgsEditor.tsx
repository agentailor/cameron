"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { looksLikeJson, splitCommandLine } from "@/lib/mcp/configParse";
import { field, iconButton, linkButton } from "./styles";

interface ArgsEditorProps {
  id: string;
  args: string[];
  onChange: (args: string[]) => void;
}

/** One input per argument, so values with spaces never need quoting. */
export function ArgsEditor({ id, args, onChange }: ArgsEditorProps) {
  const [focusIndex, setFocusIndex] = useState<number | null>(null);

  const set = (index: number, value: string) =>
    onChange(args.map((arg, i) => (i === index ? value : arg)));

  // Pasting "a b c" into one row spreads it over three.
  const handlePaste = (index: number, e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    if (looksLikeJson(text) || !/\s/.test(text.trim())) return;
    e.preventDefault();
    const words = splitCommandLine(text);
    onChange([...args.slice(0, index), ...words, ...args.slice(index + 1)]);
  };

  return (
    <div className="space-y-1.5">
      {args.map((arg, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input
            id={i === 0 ? id : undefined}
            value={arg}
            autoFocus={i === focusIndex}
            onChange={(e) => set(i, e.target.value)}
            onPaste={(e) => handlePaste(i, e)}
            placeholder={i === 0 ? "-y" : ""}
            aria-label={`Argument ${i + 1}`}
            className={`${field} font-mono`}
          />
          <button
            type="button"
            onClick={() => onChange(args.filter((_, j) => j !== i))}
            className={iconButton}
            aria-label={`Remove argument ${i + 1}`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => {
          setFocusIndex(args.length);
          onChange([...args, ""]);
        }}
        className={linkButton}
      >
        <Plus className="h-3 w-3" />
        add argument
      </button>
    </div>
  );
}
