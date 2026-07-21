/**
 * Shared database error translation, used by the repository layer to convert low-level
 * driver/ORM errors into domain-meaningful ones. Keeping this in one place means callers
 * (routes, tools) never depend on Postgres SQLSTATE codes or on how the ORM wraps errors.
 */

/** SQLSTATE for a unique-constraint violation. Stable across Postgres versions. */
const PG_UNIQUE_VIOLATION = "23505";

/**
 * Thrown when a write would violate a unique constraint. Callers supply a domain-specific
 * message (e.g. "MCP server name already exists", "category already exists"); routes map
 * this to HTTP 409.
 */
export class ConflictError extends Error {
  constructor(message = "A record with the same unique value already exists") {
    super(message);
    this.name = "ConflictError";
  }
}

/**
 * True when `err` (or its `.cause`) is a Postgres unique-violation. Drizzle wraps the pg
 * driver error in its own Error and exposes the original (which carries `code`) on `.cause`,
 * so both levels are checked.
 */
export function isUniqueViolation(err: unknown): boolean {
  const code = (e: unknown) =>
    typeof e === "object" && e !== null ? (e as { code?: string }).code : undefined;
  return (
    code(err) === PG_UNIQUE_VIOLATION ||
    code((err as { cause?: unknown } | null)?.cause) === PG_UNIQUE_VIOLATION
  );
}
