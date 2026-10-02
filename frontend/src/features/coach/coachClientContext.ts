// The user's calendar context for each Coach request (ADR-025): local today
// and the browser's IANA timezone, computed fresh at send time so a tab open
// across midnight stays correct.
//
// There is deliberately NO fallback timezone: the Coach's "today", "yesterday"
// and "this week" depend on it, and a substitute (such as UTC) would give
// grounded but wrong answers. Without a valid timezone the request is not sent.

// IANA names ("Europe/London", "America/Argentina/Buenos_Aires", "UTC");
// raw offsets such as "+05:00" are rejected, as the backend does.
const IANA_TIME_ZONE = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/

export type CoachClientContext = { today: string; timeZone: string }

export type CoachClientContextResult =
  | { ok: true; context: CoachClientContext }
  | { ok: false; reason: "timezone" }

const pad = (value: number) => String(value).padStart(2, "0")

/** The local calendar date (not the UTC date) as YYYY-MM-DD. */
export function localDateString(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return undefined
  }
}

/** True for a name the browser itself can use as a timezone. */
export function isUsableTimeZone(value: string | undefined): value is string {
  if (!value || value.length > 64 || !IANA_TIME_ZONE.test(value)) {
    return false
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value })
    return true
  } catch {
    return false
  }
}

export function getCoachClientContext(
  now: Date = new Date(),
  resolveTimeZone: () => string | undefined = browserTimeZone,
): CoachClientContextResult {
  let timeZone: string | undefined
  try {
    timeZone = resolveTimeZone()
  } catch {
    timeZone = undefined
  }

  if (!isUsableTimeZone(timeZone)) {
    return { ok: false, reason: "timezone" }
  }

  return { ok: true, context: { today: localDateString(now), timeZone } }
}
