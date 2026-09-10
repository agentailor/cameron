import { formatDistanceStrict, isSameDay, isSameYear, subDays } from "date-fns";

/**
 * Timestamp for a thread in the sidebar list: "just now" / "5 minutes ago" / "7:34 AM" /
 * "yesterday 12:34 PM" / "Jun 7" / "Aug 1, 2025".
 */
export function formatThreadTime(value: string | Date, now: Date = new Date()): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  // Reference-date forms: `isToday`/`isYesterday`/`isThisYear` would read the system clock.
  if (isSameDay(date, now)) {
    const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
    if (seconds < 60) return "just now";
    // Relative only within the hour: past that its minute granularity collapses threads started
    // seconds apart into one label, and the clock time is what separates them.
    // Measured against the passed-in `now` — `formatDistanceToNow*` ignores it.
    if (seconds < 3600) return formatDistanceStrict(date, now, { addSuffix: true });
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  if (isSameDay(date, subDays(now, 1))) {
    return `yesterday ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  }
  return date.toLocaleDateString(
    [],
    isSameYear(date, now)
      ? { month: "short", day: "numeric" }
      : { year: "numeric", month: "short", day: "numeric" },
  );
}
