/**
 * The `mode: "string"` timestamp columns hand back a naive literal ("2026-09-05 10:20:18.013")
 * that is ALREADY UTC; `new Date(...)` would read it as local and shift it by the offset. These
 * helpers pin the interpretation to UTC in both directions. Getting it wrong is silent: every value
 * still parses, it is just off by the server's UTC offset.
 */

export function columnTimestampToIso(value: string): string {
  const iso = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

/** A timestamp column's value as a `Date`, read as UTC. */
export function columnToDate(value: string): Date {
  return new Date(columnTimestampToIso(value));
}

/** ISO string -> the literal format the timestamp columns compare against (UTC, no zone suffix). */
export function toColumnTimestamp(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().replace("T", " ").replace("Z", "");
}
