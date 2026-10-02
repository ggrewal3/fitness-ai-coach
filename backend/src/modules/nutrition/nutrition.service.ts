import {
  addDays,
  datesInRange,
  fromDateColumn,
  rollingWeekPeriods,
  spanningRange,
  toDateColumn,
  trailingRange,
  type CalendarDate,
  type DateRange,
} from "../../lib/dates/calendarDate.js";
import prisma from "../../lib/prisma.js";
import type {
  CreateNutritionFoodItemInput,
  DailyNutritionSummary,
  NutritionAverages,
  NutritionFoodItemResponse,
  NutritionGroundingDay,
  NutritionGroundingResult,
  UpdateNutritionFoodItemInput,
} from "./nutrition.types.js";

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

// Database facts -> deterministic backend calculation -> AI interpretation:
// food items are grouped into per-day totals first, and averages run over
// those day aggregates, so "logged days" means days with at least one item.
type DayTotals = { calories: number; proteinGrams: number; carbsGrams: number; fatGrams: number };

function sumItems(items: DayTotals[]): DayTotals {
  const totals = items.reduce(
    (sum, item) => ({
      calories: sum.calories + item.calories,
      proteinGrams: sum.proteinGrams + item.proteinGrams,
      carbsGrams: sum.carbsGrams + item.carbsGrams,
      fatGrams: sum.fatGrams + item.fatGrams,
    }),
    { calories: 0, proteinGrams: 0, carbsGrams: 0, fatGrams: 0 }
  );

  return {
    calories: totals.calories,
    proteinGrams: roundMetric(totals.proteinGrams),
    carbsGrams: roundMetric(totals.carbsGrams),
    fatGrams: roundMetric(totals.fatGrams),
  };
}

/** Averages over logged, completed days only (unlogged days are not zero). */
function averageOf(days: NutritionGroundingDay[]): NutritionAverages {
  const logged = days.filter((day) => day.logged);
  const average = (pick: (day: NutritionGroundingDay) => number | null) =>
    logged.length > 0 ? roundMetric(logged.reduce((sum, day) => sum + (pick(day) ?? 0), 0) / logged.length) : null;

  return {
    loggedDays: logged.length,
    averageCalories: average((day) => day.calories),
    averageProteinGrams: average((day) => day.proteinGrams),
    averageCarbsGrams: average((day) => day.carbsGrams),
    averageFatGrams: average((day) => day.fatGrams),
  };
}

/**
 * Nutrition for the AI coach on logical days (entryDate, ADR-021), anchored
 * to the client's today.
 *
 * Every date in the window is listed, with `logged: false` and null totals
 * when nothing was logged, so missing days never read as zero intake. Today
 * is in progress, so it is excluded from all averages. Today's and
 * yesterday's foods are included in logging order; callers cap them.
 */
export async function getNutritionGrounding(
  userId: number,
  { today, days }: { today: CalendarDate; days: number }
): Promise<NutritionGroundingResult> {
  const window = trailingRange(today, days);
  const periods = rollingWeekPeriods(today);
  const queryRange = spanningRange(window, periods.previous);
  const yesterday = addDays(today, -1);

  const items = await prisma.nutritionFoodItem.findMany({
    where: {
      userId,
      entryDate: { gte: toDateColumn(queryRange.startDate), lte: toDateColumn(queryRange.endDate) },
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
      entryDate: true,
    },
    orderBy: [{ entryDate: "asc" }, { recordedAt: "asc" }, { id: "asc" }],
  });

  const byDate = new Map<CalendarDate, typeof items>();
  for (const item of items) {
    const date = fromDateColumn(item.entryDate);
    byDate.set(date, [...(byDate.get(date) ?? []), item]);
  }

  const dayOf = (date: CalendarDate): NutritionGroundingDay => {
    const dayItems = byDate.get(date) ?? [];

    if (dayItems.length === 0) {
      return { date, logged: false, itemCount: 0, calories: null, proteinGrams: null, carbsGrams: null, fatGrams: null };
    }

    return { date, logged: true, itemCount: dayItems.length, ...sumItems(dayItems) };
  };
  const completedDays = (range: DateRange) =>
    datesInRange(range)
      .filter((date) => date !== today)
      .map(dayOf);
  const foodsOn = (date: CalendarDate) =>
    (byDate.get(date) ?? []).map(({ entryDate: _entryDate, ...food }) => food);

  return {
    today,
    requestedDays: days,
    window: { ...window, days: datesInRange(window).reverse().map(dayOf) },
    windowAverages: averageOf(completedDays(window)),
    currentPeriod: { ...periods.current, ...averageOf(completedDays(periods.current)) },
    previousPeriod: { ...periods.previous, ...averageOf(completedDays(periods.previous)) },
    todayDetail: { ...dayOf(today), isPartialDay: true, foods: foodsOn(today) },
    yesterdayDetail: { ...dayOf(yesterday), isPartialDay: false, foods: foodsOn(yesterday) },
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
