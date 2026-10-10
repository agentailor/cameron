/**
 * Links a gated edit to the validation that previewed it, so the approval card can show what is
 * being approved: an edit's own arguments are only ids.
 *
 * The match is on identical arguments, the same rule the server applies before it will write. So
 * a matched preview is exactly what the write does, or the write refuses as `stale`. No match
 * means the write will be refused as `validation_required`, and the card says so.
 */

/** Each gated edit and the read-only tool that validates it. Names pinned in editPreview.test.ts. */
export const VALIDATOR_FOR: Record<string, string> = {
  update_transaction: "validate_transaction_update",
  delete_transaction: "validate_transaction_delete",
};

const VALIDATORS = new Set(Object.values(VALIDATOR_FOR));

/**
 * Key order is the model's, not the server's, and `ids` / `clear` are sets on the server. Sort
 * both away so the client matches the same plans the server's fingerprint does.
 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = value.map(canonical);
    return items.every((v) => typeof v === "string")
      ? [...new Set(items as string[])].sort()
      : items;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  }
  return value;
}

function planKey(tool: string, args: Record<string, unknown>): string {
  return `${tool}:${JSON.stringify(canonical(args))}`;
}

function parse(content: unknown): Record<string, unknown> | null {
  if (typeof content !== "string") return null;
  try {
    const p = JSON.parse(content) as unknown;
    return p && typeof p === "object" ? (p as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** A successful validation payload, or null for an error or a result still to come. */
function validatedPayload(content: unknown): Record<string, unknown> | null {
  const p = parse(content);
  return p?.validated === true ? p : null;
}

const succeeded = (content: unknown) => parse(content)?.ok === true;

interface Linkable {
  name: string;
  args: Record<string, unknown>;
  result: { data?: { content?: unknown } } | null;
  preview?: Record<string, unknown> | null;
}

/**
 * Walk activities in thread order and give each edit the most recent EARLIER validation of the
 * same plan. A later validation never counts: the server matched what existed when it ran.
 */
export function linkPreviews(activities: Linkable[]): void {
  const latest = new Map<string, Record<string, unknown>>();
  for (const a of activities) {
    const validator = VALIDATOR_FOR[a.name];
    if (validator) {
      const key = planKey(validator, a.args);
      a.preview = latest.get(key) ?? null;
      // A write that ran used its validation up; the server requires a fresh one for a repeat.
      if (succeeded(a.result?.data?.content)) latest.delete(key);
    } else if (VALIDATORS.has(a.name)) {
      const payload = validatedPayload(a.result?.data?.content);
      if (payload) latest.set(planKey(a.name, a.args), payload);
    }
  }
}
