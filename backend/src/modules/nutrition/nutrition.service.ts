import prisma from "../../lib/prisma.js";
import type {
  CreateNutritionFoodItemInput,
  DailyNutritionSummary,
  NutritionFoodItemResponse,
  NutritionHistoryEntry,
  NutritionHistorySummaryResult,
  UpdateNutritionFoodItemInput,
} from "./nutrition.types.js";

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

const nutritionFoodItemSelect = {
  id: true,
  foodName: true,
  quantity: true,
  unit: true,
  calories: true,
  proteinGrams: true,
  carbsGrams: true,
  fatGrams: true,
  mealType: true,
  source: true,
  entryDate: true,
  recordedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

function roundMetric(value: number): number {
  const rounded = Number(value.toFixed(2));
  return rounded === 0 ? 0 : rounded;
}

// entryDate and recordedAt are independent domain concepts: entryDate is the
// logical nutrition day the user selected, recordedAt is the food record's
// own timestamp. The client sends entryDate as an explicit "YYYY-MM-DD"
// string (Zod-validated by entryDateSchema), and it is turned into the exact
// same calendar day for Prisma's @db.Date column by direct string
// concatenation at UTC midnight - never by parsing it through a Date and
// reading local/UTC components back out, which is what could silently roll
// the selected day forward or back depending on server/browser timezone.
function toEntryDateValue(entryDateString: string): Date {
  return new Date(`${entryDateString}T00:00:00.000Z`);
}

function toEntryDateString(entryDate: Date): string {
  return entryDate.toISOString().slice(0, 10);
}

export async function createNutritionFoodItem(
  userId: number,
  input: CreateNutritionFoodItemInput
): Promise<NutritionFoodItemResponse> {
  return prisma.nutritionFoodItem.create({
    data: {
      userId,
      foodName: input.foodName,
      quantity: input.quantity,
      unit: input.unit,
      calories: input.calories,
      proteinGrams: input.proteinGrams,
      carbsGrams: input.carbsGrams,
      fatGrams: input.fatGrams,
      mealType: input.mealType,
      source: input.source,
      entryDate: toEntryDateValue(input.entryDate),
      recordedAt: new Date(input.recordedAt),
    },
    select: nutritionFoodItemSelect,
  });
}

export async function getNutritionFoodItems(
  userId: number
): Promise<NutritionFoodItemResponse[]> {
  return prisma.nutritionFoodItem.findMany({
    where: {
      userId,
    },
    orderBy: [{ entryDate: "desc" }, { recordedAt: "desc" }],
    select: nutritionFoodItemSelect,
  });
}

export async function getDailyNutritionSummary(
  userId: number,
  entryDateString: string
): Promise<DailyNutritionSummary> {
  const foodItems = await prisma.nutritionFoodItem.findMany({
    where: {
      userId,
      entryDate: toEntryDateValue(entryDateString),
    },
    select: {
      calories: true,
      proteinGrams: true,
      carbsGrams: true,
      fatGrams: true,
    },
  });

  if (foodItems.length === 0) {
    return {
      entryDate: entryDateString,
      found: false,
      totalCalories: 0,
      totalProteinGrams: 0,
      totalCarbsGrams: 0,
      totalFatGrams: 0,
      numberOfFoodItems: 0,
    };
  }

  const totals = foodItems.reduce(
    (sum, item) => ({
      calories: sum.calories + item.calories,
      proteinGrams: sum.proteinGrams + item.proteinGrams,
      carbsGrams: sum.carbsGrams + item.carbsGrams,
      fatGrams: sum.fatGrams + item.fatGrams,
    }),
    { calories: 0, proteinGrams: 0, carbsGrams: 0, fatGrams: 0 }
  );

  return {
    entryDate: entryDateString,
    found: true,
    totalCalories: totals.calories,
    totalProteinGrams: roundMetric(totals.proteinGrams),
    totalCarbsGrams: roundMetric(totals.carbsGrams),
    totalFatGrams: roundMetric(totals.fatGrams),
    numberOfFoodItems: foodItems.length,
  };
}

// Preserves the pre-existing DATABASE FACTS -> deterministic backend
// calculation -> AI interpretation contract used by getNutritionHistoryTool:
// food items are grouped into per-day totals first (matching the old
// one-row-per-day NutritionEntry semantics), and the same average/latest
// math runs over those day-aggregates. totalLoggedDays therefore still means
// "days with at least one logged food item", not "number of food items".
export async function getNutritionHistorySummary(
  userId: number,
  days: number
): Promise<NutritionHistorySummaryResult> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - days * MILLISECONDS_PER_DAY);

  const foodItems = await prisma.nutritionFoodItem.findMany({
    where: {
      userId,
      recordedAt: {
        gte: cutoff,
      },
    },
    select: {
      entryDate: true,
      calories: true,
      proteinGrams: true,
      carbsGrams: true,
      fatGrams: true,
    },
  });

  if (foodItems.length === 0) {
    return {
      found: false,
      requestedDays: days,
      summary: null,
      entries: [],
    };
  }

  const dailyTotalsByDate = new Map<
    string,
    { calories: number; proteinGrams: number; carbsGrams: number; fatGrams: number }
  >();

  for (const item of foodItems) {
    const dateKey = toEntryDateString(item.entryDate);
    const current = dailyTotalsByDate.get(dateKey) ?? {
      calories: 0,
      proteinGrams: 0,
      carbsGrams: 0,
      fatGrams: 0,
    };

    dailyTotalsByDate.set(dateKey, {
      calories: current.calories + item.calories,
      proteinGrams: current.proteinGrams + item.proteinGrams,
      carbsGrams: current.carbsGrams + item.carbsGrams,
      fatGrams: current.fatGrams + item.fatGrams,
    });
  }

  const entries: NutritionHistoryEntry[] = Array.from(dailyTotalsByDate.entries())
    .sort(([dateA], [dateB]) => (dateA < dateB ? -1 : dateA > dateB ? 1 : 0))
    .map(([dateKey, totals]) => ({
      calories: totals.calories,
      proteinGrams: roundMetric(totals.proteinGrams),
      carbsGrams: roundMetric(totals.carbsGrams),
      fatGrams: roundMetric(totals.fatGrams),
      recordedAt: new Date(`${dateKey}T00:00:00.000Z`),
    }));

  const entryCount = entries.length;
  const totals = entries.reduce(
    (sum, entry) => ({
      calories: sum.calories + entry.calories,
      proteinGrams: sum.proteinGrams + entry.proteinGrams,
      carbsGrams: sum.carbsGrams + entry.carbsGrams,
      fatGrams: sum.fatGrams + entry.fatGrams,
    }),
    { calories: 0, proteinGrams: 0, carbsGrams: 0, fatGrams: 0 }
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

export async function updateNutritionFoodItem(
  userId: number,
  itemId: number,
  input: UpdateNutritionFoodItemInput
): Promise<NutritionFoodItemResponse | null> {
  return prisma.$transaction(async (transaction) => {
    const existingItem = await transaction.nutritionFoodItem.findFirst({
      where: {
        id: itemId,
        userId,
      },
      select: {
        foodName: true,
        quantity: true,
        unit: true,
        calories: true,
        proteinGrams: true,
        carbsGrams: true,
        fatGrams: true,
        mealType: true,
        source: true,
        entryDate: true,
        recordedAt: true,
      },
    });

    if (!existingItem) {
      return null;
    }

    const recordedAt = input.recordedAt
      ? new Date(input.recordedAt)
      : existingItem.recordedAt;

    const updateResult = await transaction.nutritionFoodItem.updateMany({
      where: {
        id: itemId,
        userId,
      },
      data: {
        foodName: input.foodName ?? existingItem.foodName,
        quantity: input.quantity ?? existingItem.quantity,
        unit: input.unit ?? existingItem.unit,
        calories: input.calories ?? existingItem.calories,
        proteinGrams: input.proteinGrams ?? existingItem.proteinGrams,
        carbsGrams: input.carbsGrams ?? existingItem.carbsGrams,
        fatGrams: input.fatGrams ?? existingItem.fatGrams,
        mealType: input.mealType ?? existingItem.mealType,
        source: input.source ?? existingItem.source,
        entryDate: input.entryDate
          ? toEntryDateValue(input.entryDate)
          : existingItem.entryDate,
        recordedAt,
      },
    });

    if (updateResult.count === 0) {
      return null;
    }

    return transaction.nutritionFoodItem.findUnique({
      where: {
        id: itemId,
      },
      select: nutritionFoodItemSelect,
    });
  });
}

export async function deleteNutritionFoodItem(
  userId: number,
  itemId: number
): Promise<boolean> {
  const result = await prisma.nutritionFoodItem.deleteMany({
    where: {
      id: itemId,
      userId,
    },
  });

  return result.count > 0;
}
