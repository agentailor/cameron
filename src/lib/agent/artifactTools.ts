/**
 * The tools that return a client-only artifact alongside their model-facing content
 * (`responseFormat: "content_and_artifact"` — see `agent/tools/charts.ts`).
 *
 * This lives in its own module — with NO imports — for the same reason as `mutatingTools.ts`:
 * the SSE layer needs to know which tools to wait on, and importing the tool module drags the
 * repositories and `pg` along with it.
 *
 * The set must be a POSITIVE signal. An absent artifact and a not-yet-arrived artifact are both
 * `undefined`, so without this list the stream cannot tell "this tool has none" from "keep
 * waiting" — and waiting on every tool stalls the stream until the whole run ends.
 */
export const ARTIFACT_TOOL_NAMES = ["render_chart"] as const;

export function producesArtifact(name: string): boolean {
  return (ARTIFACT_TOOL_NAMES as readonly string[]).includes(name);
}
