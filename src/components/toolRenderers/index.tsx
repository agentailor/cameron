"use client";
import { renderersFor } from "./config";
import { SqlBlock } from "./SqlBlock";
import { ResultTable } from "./ResultTable";
import { FieldGrid } from "./FieldGrid";
import { Receipt } from "./Receipt";

/**
 * Dispatch from the catalog in `config.ts` to a component. A tool with no entry renders as JSON.
 * The agent never picks the presentation — the payload selects a renderer the client owns.
 */

/** Capped like the tables above — a schema dump is thousands of characters. */
const Json = ({ value }: { value: unknown }) => (
  <div className="bg-inset max-h-96 overflow-auto rounded-md">
    <pre className="text-inset-foreground m-0 px-3 py-2.5 font-mono text-xs leading-relaxed whitespace-pre">
      {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
    </pre>
  </div>
);

type Args = Record<string, unknown>;

/** Tool-call ARGUMENTS — what the agent is asking to do. */
export const ToolArgs = ({ toolName, args }: { toolName: string; args: Args }) => {
  const { args: kind } = renderersFor(toolName);
  if (kind === null) return null;

  switch (kind) {
    case "sql": {
      const q = typeof args.query === "string" ? args.query : "";
      return q ? <SqlBlock sql={q} /> : <Json value={args} />;
    }
    case "expense":
      return <FieldGrid args={args} lead="amount" />;
    case "filters":
    case "fields":
    case "file":
    case "csvPlan":
      return <FieldGrid args={args} />;
    default:
      return <Json value={args} />;
  }
};

/** Tool RESULT — what came back. */
export const ToolResult = ({ toolName, content }: { toolName?: string; content: string }) => {
  const { result: kind } = renderersFor(toolName);

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return <Json value={content} />;
  }

  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const p = parsed as Record<string, unknown>;
    // An error payload never looks like the tool's success shape — show it plainly.
    if (typeof p.error === "string") {
      return (
        <div className="border-destructive/40 bg-destructive/6 text-foreground/80 rounded-lg border px-3.5 py-3 text-[13px] leading-relaxed">
          {p.error}
        </div>
      );
    }
    if (kind === "table") return <ResultTable payload={p} />;
    if (kind === "receipt") return <Receipt payload={p} />;
  }

  return <Json value={parsed} />;
};

export { renderersFor, TOOL_RENDERERS } from "./config";
