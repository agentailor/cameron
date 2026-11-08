import { UnauthorizedError } from "@modelcontextprotocol/client";

const MAX_CAUSE_DEPTH = 4;

function httpStatus(value: unknown): number | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { status, code, message } = value as {
    status?: unknown;
    code?: unknown;
    message?: unknown;
  };
  if (typeof status === "number") return status;
  if (typeof code === "number") return code;
  const match = typeof message === "string" ? message.match(/\(HTTP (\d{3})\)/) : null;
  return match ? Number(match[1]) : undefined;
}

/**
 * True when the error, or one of its causes, means the server wants credentials: the SDK's
 * `UnauthorizedError` or an HTTP 401. The adapter wraps these, so the cause chain is walked.
 */
export function isAuthFailure(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth <= MAX_CAUSE_DEPTH && current !== undefined; depth += 1) {
    if (UnauthorizedError.isInstance(current) || httpStatus(current) === 401) return true;
    current = current instanceof Error ? current.cause : undefined;
  }
  return false;
}
