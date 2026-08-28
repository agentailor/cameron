import React, { useState } from "react";
import type { MessageResponse } from "@/types/message";
import { ChevronDownIcon, ChevronRightIcon, CopyIcon, CheckIcon } from "lucide-react";
import { getToolName } from "@/services/messageUtils";
import { ToolResult } from "./toolRenderers";

interface ToolMessageProps {
  message: MessageResponse;
}

const getContentStats = (content: string): string => {
  const lines = content.split("\n").length;
  const chars = content.length;
  return lines > 1 ? `${lines} lines, ${chars} chars` : `${chars} chars`;
};

/** One-line gist for the collapsed state, from the shapes the finance tools return. */
const summarize = (content: string): string | null => {
  try {
    const p = JSON.parse(content) as Record<string, unknown>;
    if (typeof p.error === "string") return p.error;
    if (typeof p.rowCount === "number") return `${p.rowCount} rows`;
    if (typeof p.matched === "number" && typeof p.returned === "number") {
      return p.returned === p.matched
        ? `${p.matched} transactions`
        : `${p.returned} of ${p.matched} transactions`;
    }
    if (p.ok === true) return "written";
    return null;
  } catch {
    return null;
  }
};

const getContentAsString = (
  content: string | import("@/types/message").ContentItem[] | undefined,
): string => {
  if (!content) return "";
  if (typeof content === "string") return content;
  return JSON.stringify(content, null, 2);
};

export const ToolMessage = ({ message }: ToolMessageProps) => {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const toolName = getToolName(message);
  const content = getContentAsString(message.data?.content);
  const summary = summarize(content);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy content:", err);
    }
  };

  return (
    <div className="border-border bg-muted/30 rounded-lg border">
      <button
        className="focus:ring-brand flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-3 text-left focus:ring-2 focus:outline-none focus:ring-inset"
        onClick={() => setOpen((o) => !o)}
      >
        <div className="flex min-w-0 items-center gap-2">
          {open ? (
            <ChevronDownIcon className="text-muted-foreground h-4 w-4 shrink-0" />
          ) : (
            <ChevronRightIcon className="text-muted-foreground h-4 w-4 shrink-0" />
          )}
          <span className="text-foreground truncate font-mono text-sm font-medium">
            {toolName ?? "tool"}
          </span>
          <span className="text-muted-foreground shrink-0 font-mono text-xs">result</span>
          <span className="text-muted-foreground truncate font-mono text-xs">
            · {summary ?? getContentStats(content)}
          </span>
        </div>
        <span
          onClick={handleCopy}
          role="button"
          tabIndex={-1}
          className="text-muted-foreground hover:text-foreground shrink-0 rounded p-1"
          title="Copy raw output"
        >
          {copied ? (
            <CheckIcon className="text-brand-dim h-3.5 w-3.5" />
          ) : (
            <CopyIcon className="h-3.5 w-3.5" />
          )}
        </span>
      </button>

      {open && (
        <div className="border-border border-t px-4 py-3.5">
          <ToolResult toolName={toolName} content={content} />
        </div>
      )}
    </div>
  );
};
