// "Reviewed" provenance under each Coach answer: public categories and the
// reviewed period, as the server derived them (ADR-026). Never tool names.
import type { CoachSource, CoachSourceType } from "../../services/api"

const SOURCE_LABELS: Record<CoachSourceType, string> = {
  profile: "Profile",
  weight: "Weight",
  nutrition: "Nutrition",
  activity: "Activity",
  workouts: "Workouts",
}

export function sourceLabel(type: CoachSourceType): string {
  return SOURCE_LABELS[type]
}

/** "YYYY-MM-DD" at UTC midnight, formatted in UTC so the day never shifts. */
function toUtcDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`)
}

/**
 * The reviewed period, e.g. "Sep 19 – Oct 2", a single day "Oct 2", or with
 * years when the range crosses one ("Dec 20, 2026 – Jan 2, 2027"). Null when
 * the source has no period (the profile).
 */
export function formatSourcePeriod(source: CoachSource, locale?: string): string | null {
  if (!source.startDate || !source.endDate) {
    return null
  }

  const start = toUtcDate(source.startDate)
  const end = toUtcDate(source.endDate)
  const crossesYear = start.getUTCFullYear() !== end.getUTCFullYear()
  const format = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    ...(crossesYear ? { year: "numeric" as const } : {}),
    timeZone: "UTC",
  })

  if (source.startDate === source.endDate) {
    return format.format(start)
  }

  return typeof format.formatRange === "function"
    ? format.formatRange(start, end)
    : `${format.format(start)} – ${format.format(end)}`
}

/** Accessible description, e.g. "Weight, Sep 19 – Oct 2". */
export function describeSource(source: CoachSource, locale?: string): string {
  const period = formatSourcePeriod(source, locale)
  return period ? `${sourceLabel(source.type)}, ${period}` : sourceLabel(source.type)
}
