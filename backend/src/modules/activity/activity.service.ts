import { ActivitySource, Prisma } from "../../generated/prisma/client.js";
import prisma from "../../lib/prisma.js";
import type {
  ActivityHistorySummaryResult,
  CreateDailyActivityInput,
  DailyActivityResponse,
  UpdateDailyActivityInput,
} from "./activity.types.js";

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

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

export async function getActivityHistorySummary(
  userId: number,
  days: number
): Promise<ActivityHistorySummaryResult> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - days * MILLISECONDS_PER_DAY);

  const entries = await prisma.dailyActivity.findMany({
    where: {
      userId,
      recordedAt: {
        gte: cutoff,
      },
    },
    select: {
      steps: true,
      walkingDistanceKm: true,
      activeCalories: true,
      source: true,
      recordedAt: true,
    },
    orderBy: {
      recordedAt: "asc",
    },
  });

  if (entries.length === 0) {
    return {
      found: false,
      requestedDays: days,
      summary: null,
      entries: [],
    };
  }

  const totalSteps = entries.reduce((sum, entry) => sum + entry.steps, 0);
  const latestEntry = entries[entries.length - 1];

  return {
    found: true,
    requestedDays: days,
    summary: {
      averageSteps: Math.round(totalSteps / entries.length),
      totalSteps,
      averageWalkingDistanceKm: averageNullable(
        entries.map((entry) => entry.walkingDistanceKm),
        roundMetric
      ),
      averageActiveCalories: averageNullable(
        entries.map((entry) => entry.activeCalories),
        Math.round
      ),
      totalLoggedDays: entries.length,
      latestSteps: latestEntry.steps,
    },
    entries,
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
