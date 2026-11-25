import { CronExpressionParser } from "cron-parser";

export type ScheduleCheck = { ok: true } | { ok: false; error: string };

/** True when `tz` is an IANA zone this runtime knows. */
export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Five fields only: the scheduler ticks once a minute, so a seconds field can't be honoured. */
export function validateSchedule(expr: string, timezone?: string): ScheduleCheck {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) {
    return {
      ok: false,
      error: `Schedule "${expr}" has ${fields.length} field(s); expected 5 (minute hour day month weekday).`,
    };
  }
  if (timezone !== undefined && !isValidTimezone(timezone)) {
    return { ok: false, error: `Unknown time zone "${timezone}".` };
  }
  try {
    CronExpressionParser.parse(expr, { tz: timezone ?? "UTC" });
  } catch (e) {
    return { ok: false, error: `Invalid schedule "${expr}": ${(e as Error).message}` };
  }
  return { ok: true };
}

/**
 * The most recent occurrence at or before `now`, or null if it falls before `notBefore`.
 *
 * Only the latest slot is ever returned, so a scheduler that was down for several periods
 * catches up once, not once per missed slot.
 */
export function latestDueSlot(
  expr: string,
  opts: { now: Date; timezone: string; notBefore?: Date },
): Date | null {
  // prev() is strictly before currentDate; +1ms makes a slot exactly at `now` count.
  const cron = CronExpressionParser.parse(expr, {
    currentDate: new Date(opts.now.getTime() + 1),
    tz: opts.timezone,
  });
  const slot = cron.prev().toDate();
  if (opts.notBefore && slot.getTime() < opts.notBefore.getTime()) return null;
  return slot;
}

/** The next occurrence strictly after `now`. For display ("next run"). */
export function nextSlot(expr: string, opts: { now: Date; timezone: string }): Date {
  return CronExpressionParser.parse(expr, { currentDate: opts.now, tz: opts.timezone })
    .next()
    .toDate();
}
