import { ActivitySource, Prisma } from "../../generated/prisma/client.js";
import {
  fromDateColumn,
  isWithinRange,
  rollingWeekPeriods,
  spanningRange,
  toDateColumn,
  trailingRange,
  type CalendarDate,
  type DateRange,
} from "../../lib/dates/calendarDate.js";
import prisma from "../../lib/prisma.js";
import type {
  ActivityAverages,
  ActivityGroundingEntry,
  ActivityGroundingResult,
  CreateDailyActivityInput,
  DailyActivityResponse,
  UpdateDailyActivityInput,
} from "./activity.types.js";

const dailyActivitySelect = {
  id: true,
  steps: true,
  walkingDistanceKm: true,
  activeCalories: true,
  source: true,
  recordedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export class DailyActivityConflictError extends Error {
  constructor() {
    super("An activity entry already exists for that calendar day.");
    this.name = "DailyActivityConflictError";
  }
}

function normalizeActivityDate(recordedAt: string): Date {
  const calendarDate = /^(\d{4}-\d{2}-\d{2})/.exec(recordedAt)?.[1];

  if (!calendarDate) {
    throw new Error("Invalid recordedAt calendar date.");
  }

  return new Date(`${calendarDate}T00:00:00.000Z`);
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

function roundMetric(value: number): number {
  const rounded = Number(value.toFixed(2));
  return rounded === 0 ? 0 : rounded;
}

function averageNullable(
  values: Array<number | null>,
  round: (value: number) => number
): number | null {
  const presentValues = values.filter(
    (value): value is number => value !== null
  );

  if (presentValues.length === 0) {
    return null;
  }

  const total = presentValues.reduce((sum, value) => sum + value, 0);

  return round(total / presentValues.length);
}

export async function createDailyActivity(
  userId: number,
  input: CreateDailyActivityInput
): Promise<DailyActivityResponse> {
  try {
    return await prisma.dailyActivity.create({
      data: {
        userId,
        activityDate: normalizeActivityDate(input.recordedAt),
        steps: input.steps,
        walkingDistanceKm: input.walkingDistanceKm,
        activeCalories: input.activeCalories,
        source: ActivitySource.MANUAL,
        recordedAt: new Date(input.recordedAt),
      },
      select: dailyActivitySelect,
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new DailyActivityConflictError();
    }

    throw error;
  }
}

export async function getDailyActivities(
  userId: number
): Promise<DailyActivityResponse[]> {
  return prisma.dailyActivity.findMany({
    where: {
      userId,
    },
    orderBy: [{ activityDate: "desc" }, { recordedAt: "desc" }],
    select: dailyActivitySelect,
  });
}

function summarizeActivity(entries: ActivityGroundingEntry[]): ActivityAverages {
  return {
    loggedDays: entries.length,
    averageSteps: entries.length > 0 ? Math.round(entries.reduce((sum, entry) => sum + entry.steps, 0) / entries.length) : null,
    averageWalkingDistanceKm: averageNullable(entries.map((entry) => entry.walkingDistanceKm), roundMetric),
    averageActiveCalories: averageNullable(entries.map((entry) => entry.activeCalories), Math.round),
  };
}

/**
 * Daily activity for the AI coach on logical days (activityDate, ADR-021),
 * anchored to the client's today. Only logged days are listed; averages run
 * over logged days, never treating a missing day as zero.
 */
export async function getActivityGrounding(
  userId: number,
  { today, days }: { today: CalendarDate; days: number }
): Promise<ActivityGroundingResult> {
  const window = trailingRange(today, days);
  const periods = rollingWeekPeriods(today);
  const queryRange = spanningRange(window, periods.previous);

  const rows = await prisma.dailyActivity.findMany({
    where: {
      userId,
      activityDate: { gte: toDateColumn(queryRange.startDate), lte: toDateColumn(queryRange.endDate) },
    },
    select: { activityDate: true, steps: true, walkingDistanceKm: true, activeCalories: true },
    orderBy: { activityDate: "desc" },
  });

  const entries: ActivityGroundingEntry[] = rows.map(({ activityDate, ...entry }) => ({
    date: fromDateColumn(activityDate),
    ...entry,
  }));
  const within = (range: DateRange) => entries.filter((entry) => isWithinRange(entry.date, range));

  return {
    today,
    requestedDays: days,
    window: { ...window, entries: within(window), ...summarizeActivity(within(window)) },
    currentPeriod: { ...periods.current, ...summarizeActivity(within(periods.current)) },
    previousPeriod: { ...periods.previous, ...summarizeActivity(within(periods.previous)) },
  };
}

export async function updateDailyActivity(
  userId: number,
  activityId: number,
  input: UpdateDailyActivityInput
): Promise<DailyActivityResponse | null> {
  try {
    return await prisma.$transaction(async (transaction) => {
      const existingActivity = await transaction.dailyActivity.findFirst({
        where: {
          id: activityId,
          userId,
        },
        select: {
          activityDate: true,
          steps: true,
          walkingDistanceKm: true,
          activeCalories: true,
          recordedAt: true,
        },
      });

      if (!existingActivity) {
        return null;
      }

      const recordedAt = input.recordedAt
        ? new Date(input.recordedAt)
        : existingActivity.recordedAt;

      const updateResult = await transaction.dailyActivity.updateMany({
        where: {
          id: activityId,
          userId,
        },
        data: {
          activityDate: input.recordedAt
            ? normalizeActivityDate(input.recordedAt)
            : existingActivity.activityDate,
          steps: input.steps ?? existingActivity.steps,
          walkingDistanceKm:
            input.walkingDistanceKm ?? existingActivity.walkingDistanceKm,
          activeCalories:
            input.activeCalories ?? existingActivity.activeCalories,
          recordedAt,
        },
      });

      if (updateResult.count === 0) {
        return null;
      }

      return transaction.dailyActivity.findUnique({
        where: {
          id: activityId,
        },
        select: dailyActivitySelect,
      });
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new DailyActivityConflictError();
    }

    throw error;
  }
}

export async function deleteDailyActivity(
  userId: number,
  activityId: number
): Promise<boolean> {
  const result = await prisma.dailyActivity.deleteMany({
    where: {
      id: activityId,
      userId,
    },
  });

  return result.count > 0;
}
