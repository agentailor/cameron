/**
 * Pairs a `log_from_document` call with the reading the agent based it on, so the approval card
 * can show what the document said beside the values being approved. See docs/DOCUMENTS.md.
 *
 * Keyed on the file, not the arguments: the reading is evidence about the document, and the
 * values on the call are the agent's claims about it. Only an EARLIER successful reading counts;
 * a withheld document (`untrusted_document`) never pairs, so its card shows the image alone.
 */

interface Linkable {
  name: string;
  args: Record<string, unknown>;
  result: { data?: { content?: unknown } } | null;
  preview?: Record<string, unknown> | null;
}

function reading(content: unknown): Record<string, unknown> | null {
  if (typeof content !== "string") return null;
  try {
    const p = JSON.parse(content) as Record<string, unknown> | null;
    return p && p.ok === true && typeof p.kind === "string" ? p : null;
  } catch {
    return null;
  }
}

export function linkDocumentReadings(activities: Linkable[]): void {
  const latest = new Map<string, Record<string, unknown>>();
  for (const a of activities) {
    const fileKey = typeof a.args.fileKey === "string" ? a.args.fileKey : null;
    if (!fileKey) continue;
    if (a.name === "read_document") {
      const r = reading(a.result?.data?.content);
      if (r) latest.set(fileKey, r);
    } else if (a.name === "log_from_document") {
      a.preview = latest.get(fileKey) ?? null;
    }
  }
}
