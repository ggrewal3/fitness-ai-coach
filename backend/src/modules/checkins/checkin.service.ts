import {
  calendarDateInTimeZone,
  daysBetween,
  instantRangeCovering,
  isWithinRange,
  rollingWeekPeriods,
  spanningRange,
  trailingRange,
  type CalendarDate,
  type DateRange,
} from "../../lib/dates/calendarDate.js";
import prisma from "../../lib/prisma.js";
import type {
  CreateCheckInInput,
  WeightTrendPeriod,
  WeightTrendResult,
} from "./checkin.types.js";

function roundMetric(value: number): number {
  const rounded = Number(value.toFixed(2));
  return rounded === 0 ? 0 : rounded;
}

export async function createWeightCheckIn(
  userId: number,
  checkInData: CreateCheckInInput
) {
  return prisma.weightCheckIn.create({
    data: {
      userId,
      weightKg: checkInData.weightKg,
      recordedAt: new Date(checkInData.recordedAt),
    },
  });
}

export async function getMyWeightCheckIns(userId: number) {
  return prisma.weightCheckIn.findMany({
    where: {
      userId,
    },
    orderBy: {
      recordedAt: "desc",
    },
  });
}

/** Minimum days with check-ins in EACH compared 7-day period before averages are compared. */
export const WEIGHT_TREND_MIN_DAYS_PER_PERIOD = 3;
export const WEIGHT_TREND_SUFFICIENCY_RULE =
  "Averages are compared only when each 7-day period has check-ins on at least 3 different days.";

interface LocalCheckIn {
  date: CalendarDate;
  weightKg: number;
  recordedAt: Date;
}

/**
 * The most recent check-in on or before the user's today, however old, with
 * its local date. A few rows are read in case the newest fall after today.
 */
export async function getLatestCheckIn(
  userId: number,
  { today, timeZone }: { today: CalendarDate; timeZone: string }
): Promise<{ date: CalendarDate; weightKg: number; daysAgo: number } | null> {
  const rows = await prisma.weightCheckIn.findMany({
    where: { userId, recordedAt: { lt: instantRangeCovering({ startDate: today, endDate: today }).before } },
    select: { weightKg: true, recordedAt: true },
    orderBy: { recordedAt: "desc" },
    take: 5,
  });
  const latest = rows
    .map((row) => ({ weightKg: row.weightKg, date: calendarDateInTimeZone(row.recordedAt, timeZone) }))
    .find((row) => row.date <= today);

  return latest ? { ...latest, daysAgo: daysBetween(latest.date, today) } : null;
}

/** Days are averaged first, so several weigh-ins on one day count once. */
function summarizePeriod(checkIns: LocalCheckIn[], range: DateRange): WeightTrendPeriod {
  const byDate = new Map<CalendarDate, number[]>();

  for (const checkIn of checkIns) {
    if (isWithinRange(checkIn.date, range)) {
      byDate.set(checkIn.date, [...(byDate.get(checkIn.date) ?? []), checkIn.weightKg]);
    }
  }

  const dayAverages = [...byDate.values()].map((weights) => weights.reduce((sum, weight) => sum + weight, 0) / weights.length);

  return {
    ...range,
    checkInCount: [...byDate.values()].reduce((sum, weights) => sum + weights.length, 0),
    daysWithCheckIns: byDate.size,
    averageWeightKg:
      dayAverages.length > 0 ? roundMetric(dayAverages.reduce((sum, value) => sum + value, 0) / dayAverages.length) : null,
  };
}

/**
 * Weight trend for the AI coach, on the user's own calendar (check-ins are
 * placed on local dates with the validated IANA timezone).
 *
 * Compares the rolling 7 days ending today with the 7 days before them, and
 * only when both periods meet WEIGHT_TREND_SUFFICIENCY_RULE; otherwise the
 * comparison fields are null and `reasons` explains why.
 */
export async function getWeightTrend(
  userId: number,
  { today, timeZone, days }: { today: CalendarDate; timeZone: string; days: number }
): Promise<WeightTrendResult> {
  const periods = rollingWeekPeriods(today);
  const historyRange = trailingRange(today, days);
  const queryRange = spanningRange(historyRange, periods.previous);
  const instants = instantRangeCovering(queryRange);

  const [rows, latest] = await Promise.all([
    prisma.weightCheckIn.findMany({
      where: { userId, recordedAt: { gte: instants.from, lt: instants.before } },
      select: { weightKg: true, recordedAt: true },
      orderBy: { recordedAt: "desc" },
    }),
    getLatestCheckIn(userId, { today, timeZone }),
  ]);

  const checkIns = rows
    .map((row) => ({ ...row, date: calendarDateInTimeZone(row.recordedAt, timeZone) }))
    .filter((checkIn) => isWithinRange(checkIn.date, queryRange));

  const current = summarizePeriod(checkIns, periods.current);
  const previous = summarizePeriod(checkIns, periods.previous);
  const reasons: string[] = [];

  if (current.daysWithCheckIns < WEIGHT_TREND_MIN_DAYS_PER_PERIOD) {
    reasons.push(`The current 7 days have check-ins on ${current.daysWithCheckIns} of the required ${WEIGHT_TREND_MIN_DAYS_PER_PERIOD} days.`);
  }
  if (previous.daysWithCheckIns < WEIGHT_TREND_MIN_DAYS_PER_PERIOD) {
    reasons.push(`The previous 7 days have check-ins on ${previous.daysWithCheckIns} of the required ${WEIGHT_TREND_MIN_DAYS_PER_PERIOD} days.`);
  }

  const sufficient = reasons.length === 0 && current.averageWeightKg !== null && previous.averageWeightKg !== null;
  const averageChangeKg = sufficient ? roundMetric(current.averageWeightKg! - previous.averageWeightKg!) : null;
  // The two period midpoints are exactly 7 days apart, so this is a weekly rate.
  const weeklyPercentChange =
    sufficient && previous.averageWeightKg! > 0
      ? roundMetric(((current.averageWeightKg! - previous.averageWeightKg!) / previous.averageWeightKg!) * 100)
      : null;

  const history = checkIns
    .filter((checkIn) => isWithinRange(checkIn.date, historyRange))
    .map(({ date, weightKg }) => ({ date, weightKg }));

  return {
    today,
    requestedDays: days,
    latestCheckIn: latest,
    currentPeriod: current,
    previousPeriod: previous,
    comparison: {
      sufficient,
      rule: WEIGHT_TREND_SUFFICIENCY_RULE,
      reasons,
      averageChangeKg,
      weeklyPercentChange,
    },
    history: { ...historyRange, checkIns: history },
  };
}

export async function deleteMyWeightCheckIn(
  userId: number,
  checkInId: number
) {
  const result = await prisma.weightCheckIn.deleteMany({
    where: {
      id: checkInId,
      userId,
    },
  });

  return result.count > 0;
}
