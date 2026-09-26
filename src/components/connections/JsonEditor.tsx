"use client";

import { useRef } from "react";
import { Check, TriangleAlert, Wand2, X } from "lucide-react";

export type JsonStatus =
  | { tone: "ok"; text: string }
  | { tone: "warn"; text: string }
  | { tone: "error"; text: string }
  | null;

interface JsonEditorProps {
  value: string;
  onChange: (value: string) => void;
  status: JsonStatus;
}

const TONE = {
  ok: { className: "text-term-green", Icon: Check },
  warn: { className: "text-term-yellow", Icon: TriangleAlert },
  error: { className: "text-term-red", Icon: X },
};

/** A code-style editor on the dark inset: line numbers, no wrapping, and one status line. */
export function JsonEditor({ value, onChange, status }: JsonEditorProps) {
  const gutterRef = useRef<HTMLDivElement>(null);
  const lineCount = value.split("\n").length;

  const format = () => {
    try {
      onChange(JSON.stringify(JSON.parse(value), null, 2));
    } catch {
      // Invalid JSON: the status line already says where.
    }
  };

  // A whole-document paste of strict JSON arrives formatted.
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    const replacesAll =
      !value.trim() || (el.selectionStart === 0 && el.selectionEnd === value.length);
    if (!replacesAll) return;
    try {
      const formatted = JSON.stringify(JSON.parse(e.clipboardData.getData("text")), null, 2);
      e.preventDefault();
      onChange(formatted);
    } catch {
      // Not strict JSON (a fragment, trailing commas): paste as-is.
    }
  };

  const tone = status ? TONE[status.tone] : null;

  return (
    <div className="border-inset-border bg-inset overflow-hidden rounded-lg border">
      <div className="border-inset-border bg-inset-chrome flex items-center justify-between border-b px-3 py-1.5">
        <span className="text-inset-muted font-mono text-[10px] tracking-[0.12em]">JSON</span>
        <button
          type="button"
          onClick={format}
          className="text-inset-muted hover:text-inset-foreground inline-flex cursor-pointer items-center gap-1.5 font-mono text-[11px] transition-colors"
        >
          <Wand2 className="h-3 w-3" />
          format
        </button>
      </div>

      <div className="flex h-72">
        <div
          ref={gutterRef}
          aria-hidden
          className="text-inset-muted border-inset-border shrink-0 overflow-hidden border-r py-3 pr-2.5 pl-3 text-right font-mono text-xs leading-5 select-none"
        >
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onPaste={handlePaste}
          onScroll={(e) => {
            if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop;
          }}
          wrap="off"
          spellCheck={false}
          aria-label="Server configuration JSON"
          placeholder='{ "mcpServers": { … } }'
          className="text-inset-foreground placeholder:text-inset-muted caret-inset-foreground min-w-0 flex-1 resize-none bg-transparent px-3 py-3 font-mono text-xs leading-5 focus:outline-none"
        />
      </div>

      {status && tone && (
        <div
          role="status"
          className={`border-inset-border bg-inset-chrome flex items-start gap-2 border-t px-3 py-2 font-mono text-[11px] ${tone.className}`}
        >
          <tone.Icon className="mt-px h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 break-words">{status.text}</span>
        </div>
      )}
    </div>
  );
}
