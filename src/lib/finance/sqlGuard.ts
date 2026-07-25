/**
 * Static validation for the agent's read-only SQL tool (`run_sql`). This is the FIRST line of
 * defense — it rejects anything that isn't a single read-only SELECT before the query ever reaches
 * Postgres. The REAL guard is the read-only transaction + statement_timeout in
 * `analyticsRepository.runReadOnlyQuery`; even if a clever payload slips past these regexes,
 * Postgres itself refuses to write inside a `READ ONLY` transaction. Defense in depth.
 *
 * Pure and DB-free so it can be unit-tested in isolation.
 */

/** Hard ceiling on rows the tool will ever return to the model, regardless of the query. */
export const MAX_SQL_ROWS = 500;

export type ValidationResult = { ok: true } | { ok: false; reason: string };

/**
 * Strip SQL comments and string literals so keyword scanning can't be fooled by a keyword that
 * only appears inside a comment or a quoted string (e.g. a note containing the word "delete").
 * Replaces literals/comments with spaces to preserve token boundaries.
 */
function stripCommentsAndStrings(sql: string): string {
  return (
    sql
      // block comments /* ... */ (non-greedy, across newlines)
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      // line comments -- ... to end of line
      .replace(/--[^\n]*/g, " ")
      // single-quoted string literals (handles doubled '' escapes)
      .replace(/'(?:[^']|'')*'/g, " ")
      // dollar-quoted strings $$...$$ / $tag$...$tag$
      .replace(/\$([A-Za-z_]\w*)?\$[\s\S]*?\$\1\$/g, " ")
  );
}

// The read-only transaction in analyticsRepository is the real write-guard; this list is
// belt-and-suspenders and also covers read-side escape hatches a read-only tx does NOT block
// (SET/RESET session state, COPY, volatile functions). A restricted DB role will supersede it later.
// `select`/`with` are intentionally absent — those are the only allowed leading keywords.
const FORBIDDEN_KEYWORDS = [
  "insert",
  "update",
  "delete",
  "drop",
  "alter",
  "create",
  "truncate",
  "grant",
  "revoke",
  "copy",
  "merge",
  "call",
  "do",
  "vacuum",
  "analyze",
  "reindex",
  "cluster",
  "comment",
  "lock",
  "set",
  "reset",
  "begin",
  "commit",
  "rollback",
  "savepoint",
  "prepare",
  "execute",
  "listen",
  "notify",
  "refresh",
];

/**
 * Validate that `sql` is a single, read-only SELECT (optionally a `WITH ... SELECT` CTE). Returns
 * `{ ok: true }` or a reason the model can act on. This does NOT execute anything.
 */
export function validateSelect(sql: string): ValidationResult {
  const raw = sql?.trim() ?? "";
  if (!raw) return { ok: false, reason: "Query is empty." };

  // Work on a copy with comments/strings blanked out for structural checks.
  const scrubbed = stripCommentsAndStrings(raw);

  // Exactly one statement: at most a single trailing semicolon is allowed.
  const withoutTrailingSemi = scrubbed.replace(/;\s*$/, "");
  if (withoutTrailingSemi.includes(";")) {
    return { ok: false, reason: "Only a single statement is allowed (no ';' separators)." };
  }

  const normalized = withoutTrailingSemi.trim();
  const lower = normalized.toLowerCase();

  // Must START with select or with.
  if (!/^\s*(select|with)\b/.test(lower)) {
    return {
      ok: false,
      reason: "Only SELECT queries are allowed (optionally a WITH … SELECT CTE).",
    };
  }

  // A WITH clause must resolve to a SELECT, never a data-modifying CTE (WITH ... INSERT/UPDATE/DELETE).
  // The keyword scan below catches those, but call it out explicitly for a clearer message.
  if (lower.startsWith("with") && !/\bselect\b/.test(lower)) {
    return { ok: false, reason: "A WITH clause must contain a SELECT." };
  }

  // No forbidden statement keywords anywhere (comments/strings already stripped).
  for (const kw of FORBIDDEN_KEYWORDS) {
    const re = new RegExp(`\\b${kw}\\b`, "i");
    if (re.test(normalized)) {
      return {
        ok: false,
        reason: `Disallowed keyword "${kw.toUpperCase()}" — only read-only SELECT is permitted.`,
      };
    }
  }

  // Block writes disguised as functions and other escape hatches.
  if (/\bpg_sleep\b/i.test(normalized)) {
    return { ok: false, reason: "pg_sleep is not allowed." };
  }
  if (/\binto\s+\w/i.test(normalized)) {
    // SELECT ... INTO creates a table.
    return { ok: false, reason: "SELECT … INTO is not allowed (it creates a table)." };
  }

  return { ok: true };
}

/**
 * Ensure the query is bounded: if it has no top-level LIMIT, append `LIMIT max`; if it has a LIMIT
 * larger than `max` (or none we can safely detect), we rely on the caller also slicing results.
 * Conservative — appends a LIMIT only when none is present, so we never fight a user-supplied one;
 * the repository hard-caps the returned rows regardless.
 */
export function enforceLimit(sql: string, max: number = MAX_SQL_ROWS): string {
  const trimmed = sql.trim().replace(/;\s*$/, "");
  const scrubbed = stripCommentsAndStrings(trimmed);
  const hasLimit = /\blimit\s+\d/i.test(scrubbed);
  if (hasLimit) return trimmed;
  return `${trimmed}\nLIMIT ${max}`;
}
