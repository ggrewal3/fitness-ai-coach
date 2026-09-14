import { Prisma } from "../../generated/prisma/client.js";
import prisma from "../../lib/prisma.js";
import type {
  CreateNutritionEntryInput,
  NutritionHistorySummaryResult,
  NutritionEntryResponse,
  UpdateNutritionEntryInput,
} from "./nutrition.types.js";

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

const nutritionEntrySelect = {
  id: true,
  calories: true,
  proteinGrams: true,
  carbsGrams: true,
  fatGrams: true,
  recordedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

function roundMetric(value: number): number {
  const rounded = Number(value.toFixed(2));
  return rounded === 0 ? 0 : rounded;
}

export class NutritionEntryConflictError extends Error {
  constructor() {
    super("A nutrition entry already exists for that calendar day.");
    this.name = "NutritionEntryConflictError";
  }
}

function normalizeEntryDate(recordedAt: string): Date {
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

export async function createNutritionEntry(
  userId: number,
  input: CreateNutritionEntryInput
): Promise<NutritionEntryResponse> {
  const recordedAt = new Date(input.recordedAt);

  try {
    return await prisma.nutritionEntry.create({
      data: {
        userId,
        entryDate: normalizeEntryDate(input.recordedAt),
        calories: input.calories,
        proteinGrams: input.proteinGrams,
        carbsGrams: input.carbsGrams,
        fatGrams: input.fatGrams,
        recordedAt,
      },
      select: nutritionEntrySelect,
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new NutritionEntryConflictError();
    }

    throw error;
  }
}

export async function getNutritionEntries(
  userId: number
): Promise<NutritionEntryResponse[]> {
  return prisma.nutritionEntry.findMany({
    where: {
      userId,
    },
    orderBy: {
      recordedAt: "desc",
    },
    select: nutritionEntrySelect,
  });
}

export async function getNutritionHistorySummary(
  userId: number,
  days: number
): Promise<NutritionHistorySummaryResult> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - days * MILLISECONDS_PER_DAY);

  const entries = await prisma.nutritionEntry.findMany({
    where: {
      userId,
      recordedAt: {
        gte: cutoff,
      },
    },
    select: {
      calories: true,
      proteinGrams: true,
      carbsGrams: true,
      fatGrams: true,
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

  const entryCount = entries.length;
  const totals = entries.reduce(
    (sum, entry) => ({
      calories: sum.calories + entry.calories,
      proteinGrams: sum.proteinGrams + entry.proteinGrams,
      carbsGrams: sum.carbsGrams + entry.carbsGrams,
      fatGrams: sum.fatGrams + entry.fatGrams,
    }),
    {
      calories: 0,
      proteinGrams: 0,
      carbsGrams: 0,
      fatGrams: 0,
    }
  );
  const latestEntry = entries[entryCount - 1];

  return {
    found: true,
    requestedDays: days,
    summary: {
      averageCalories: roundMetric(totals.calories / entryCount),
      averageProteinGrams: roundMetric(totals.proteinGrams / entryCount),
      averageCarbsGrams: roundMetric(totals.carbsGrams / entryCount),
      averageFatGrams: roundMetric(totals.fatGrams / entryCount),
      totalLoggedDays: entryCount,
      latestCalories: latestEntry.calories,
      latestProteinGrams: latestEntry.proteinGrams,
    },
    entries,
  };
}

export async function updateNutritionEntry(
  userId: number,
  entryId: number,
  input: UpdateNutritionEntryInput
): Promise<NutritionEntryResponse | null> {
  try {
    return await prisma.$transaction(async (transaction) => {
      const existingEntry = await transaction.nutritionEntry.findFirst({
        where: {
          id: entryId,
          userId,
        },
        select: {
          entryDate: true,
          calories: true,
          proteinGrams: true,
          carbsGrams: true,
          fatGrams: true,
          recordedAt: true,
        },
      });

      if (!existingEntry) {
        return null;
      }

      const recordedAt = input.recordedAt
        ? new Date(input.recordedAt)
        : existingEntry.recordedAt;

      const updateResult = await transaction.nutritionEntry.updateMany({
        where: {
          id: entryId,
          userId,
        },
        data: {
          entryDate: input.recordedAt
            ? normalizeEntryDate(input.recordedAt)
            : existingEntry.entryDate,
          calories: input.calories ?? existingEntry.calories,
          proteinGrams: input.proteinGrams ?? existingEntry.proteinGrams,
          carbsGrams: input.carbsGrams ?? existingEntry.carbsGrams,
          fatGrams: input.fatGrams ?? existingEntry.fatGrams,
          recordedAt,
        },
      });

      if (updateResult.count === 0) {
        return null;
      }

      return transaction.nutritionEntry.findUnique({
        where: {
          id: entryId,
        },
        select: nutritionEntrySelect,
      });
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new NutritionEntryConflictError();
    }

    throw error;
  }
}

export async function deleteNutritionEntry(
  userId: number,
  entryId: number
): Promise<boolean> {
  const result = await prisma.nutritionEntry.deleteMany({
    where: {
      id: entryId,
      userId,
    },
  });

  return result.count > 0;
}
