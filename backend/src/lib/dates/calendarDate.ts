// Calendar-date arithmetic for user-relative periods (ADR-021).
//
// A calendar date is a "YYYY-MM-DD" string. Arithmetic runs on UTC midnight,
// so it is unaffected by the server's timezone and by DST. The user's "today"
// always comes from the validated client context, never from the server clock;
// an IANA timezone is only used to place timestamps (e.g. weight check-ins)
// on the user's calendar.

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
// IANA names such as "Europe/London", "America/Argentina/Buenos_Aires",
// "Etc/GMT+5" or "UTC". Raw offsets like "+05:00" are rejected.
const IANA_TIME_ZONE_PATTERN = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/;
const TIME_ZONE_MAX_LENGTH = 64;

export type CalendarDate = string;

/** Inclusive range of calendar dates. */
export interface DateRange {
  startDate: CalendarDate;
  endDate: CalendarDate;
}

export function isCalendarDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** UTC midnight of a calendar date: the value Prisma uses for DATE columns. */
export function toDateColumn(date: CalendarDate): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

export function fromDateColumn(value: Date): CalendarDate {
  return value.toISOString().slice(0, 10);
}

export function addDays(date: CalendarDate, days: number): CalendarDate {
  const value = toDateColumn(date);
  value.setUTCDate(value.getUTCDate() + days);
  return fromDateColumn(value);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: CalendarDate, to: CalendarDate): number {
  return Math.round((toDateColumn(to).getTime() - toDateColumn(from).getTime()) / MILLISECONDS_PER_DAY);
}

export function isWithinRange(date: CalendarDate, range: DateRange): boolean {
  return date >= range.startDate && date <= range.endDate;
}

/** The `days` calendar days ending on (and including) `today`. */
export function trailingRange(today: CalendarDate, days: number): DateRange {
  return { startDate: addDays(today, -(days - 1)), endDate: today };
}

/**
 * Rolling comparison periods: the 7 days ending today, and the 7 days
 * immediately before them. No locale or calendar-week semantics.
 */
export function rollingWeekPeriods(today: CalendarDate): { current: DateRange; previous: DateRange } {
  return {
    current: trailingRange(today, 7),
    previous: { startDate: addDays(today, -13), endDate: addDays(today, -7) },
  };
}

/** Every date in a range, oldest first. */
export function datesInRange(range: DateRange): CalendarDate[] {
  const dates: CalendarDate[] = [];

  for (let date = range.startDate; date <= range.endDate; date = addDays(date, 1)) {
    dates.push(date);
  }

  return dates;
}

/** The earliest start and latest end of several ranges. */
export function spanningRange(...ranges: DateRange[]): DateRange {
  return {
    startDate: ranges.reduce((min, range) => (range.startDate < min ? range.startDate : min), ranges[0].startDate),
    endDate: ranges.reduce((max, range) => (range.endDate > max ? range.endDate : max), ranges[0].endDate),
  };
}

/**
 * Instants that can fall on any date of `range` in any timezone (UTC−12 to
 * UTC+14). Query timestamps with this, then keep only rows whose local date
 * (calendarDateInTimeZone) is inside the range.
 */
export function instantRangeCovering(range: DateRange): { from: Date; before: Date } {
  return {
    from: toDateColumn(addDays(range.startDate, -1)),
    before: toDateColumn(addDays(range.endDate, 2)),
  };
}

/**
 * True for a valid IANA timezone name. The name is used as given: ICU's own
 * "canonical" form can be a legacy alias (Asia/Kolkata → Asia/Calcutta).
 */
export function isValidTimeZone(value: string): boolean {
  if (value.length > TIME_ZONE_MAX_LENGTH || !IANA_TIME_ZONE_PATTERN.test(value)) {
    return false;
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function dateFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);

  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    formatters.set(timeZone, formatter);
  }

  return formatter;
}

/** The calendar date of an instant in an IANA timezone (DST-aware). */
export function calendarDateInTimeZone(instant: Date, timeZone: string): CalendarDate {
  const parts = dateFormatter(timeZone).formatToParts(instant);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
