import type { MessageResponse } from "@/types/message";
import type { ToolActivity } from "./toolActivity";
import { isMutatingTool } from "@/lib/agent/mutatingTools";

/**
 * The one-line gist shown on a collapsed tool card.
 *
 * A single call can be described precisely — its own payload says what came back. A run of several
 * calls cannot: the payloads have different shapes and no useful summary spans them, so the card
 * reports the COUNT instead of inventing a combined figure.
 */

function contentToString(content: MessageResponse["data"]["content"]): string {
  if (!content) return "";
  return typeof content === "string" ? content : JSON.stringify(content);
}

/**
 * Read the gist out of the shapes the finance tools actually return.
 *
 * `toolName` decides how `ok: true` reads: only a MUTATING tool wrote anything. Saying "written"
 * for a read-only tool claims a side effect that never happened, and in a finance agent that word
 * is load-bearing.
 */
export function summarizeResult(content: string, toolName?: string): string | null {
  try {
    const p = JSON.parse(content) as Record<string, unknown>;
    if (typeof p.error === "string") return p.error;
    if (typeof p.rowCount === "number") return `${p.rowCount} rows`;
    if (typeof p.matched === "number" && typeof p.returned === "number") {
      return p.returned === p.matched
        ? `${p.matched} transactions`
        : `${p.returned} of ${p.matched} transactions`;
    }
    if (p.ok === true) return toolName && !isMutatingTool(toolName) ? "ok" : "written";
    return null;
  } catch {
    return null;
  }
}

/** Label for a group's collapsed header. */
export function summarizeActivities(activities: ToolActivity[]): string {
  if (activities.length === 0) return "no tools";

  if (activities.length > 1) {
    // Deliberately generic — see the module note. Counting is the only honest claim here.
    return `${activities.length} tools called`;
  }

  const [only] = activities;
  if (only.isPending) return "awaiting approval";
  if (!only.result) return "running…";

  const gist = summarizeResult(contentToString(only.result.data?.content), only.name);
  return gist ? `${only.name} · ${gist}` : only.name;
}
