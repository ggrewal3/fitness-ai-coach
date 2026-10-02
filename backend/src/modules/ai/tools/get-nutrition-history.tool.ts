import { z } from "zod";
import { formatBodyWeight, roundTo } from "../../../lib/units/displayUnits.js";
import { getLatestCheckIn } from "../../checkins/checkin.service.js";
import { getNutritionGrounding } from "../../nutrition/nutrition.service.js";
import type { NutritionGroundingDetail } from "../../nutrition/nutrition.types.js";
import { TOOL_MAX_DAYS } from "../coach.limits.js";
import { capList, TOOL_OUTPUT_LIMITS, truncateText } from "./tool.output.js";
import type { ToolDefinition } from "./tool.types.js";

/** Protein per kg uses a check-in no older than this. */
export const PROTEIN_REFERENCE_MAX_AGE_DAYS = 14;

const getNutritionHistoryArgsSchema = z
  .object({
    days: z.number().finite().int().min(1).max(TOOL_MAX_DAYS),
  })
  .strict();

type GetNutritionHistoryArgs = z.infer<typeof getNutritionHistoryArgsSchema>;

function proteinPerKg(proteinGrams: number | null, weightKg: number | null): number | null {
  return proteinGrams === null || weightKg === null ? null : roundTo(proteinGrams / weightKg, 2);
}

/** Food names and units are user-authored text: shortened and returned as data. */
function dayDetail(detail: NutritionGroundingDetail) {
  const foods = capList(detail.foods, TOOL_OUTPUT_LIMITS.nutritionFoodsPerDay);
  const { foods: _foods, ...totals } = detail;

  return {
    ...totals,
    totalFoods: foods.total,
    foodsTruncated: foods.truncated,
    foods: foods.items.map((food) => ({
      ...food,
      foodName: truncateText(food.foodName, TOOL_OUTPUT_LIMITS.nameChars).text,
      unit: truncateText(food.unit, TOOL_OUTPUT_LIMITS.unitChars).text,
    })),
  };
}

export const getNutritionHistoryTool: ToolDefinition<GetNutritionHistoryArgs, unknown> = {
  name: "getNutritionHistory",
  description:
    "Retrieve the user's nutrition by logical day: every day of the last `days` days with a `logged` flag and calorie/macro totals, backend-calculated averages over logged completed days, current vs previous rolling 7-day averages, and detail (including foods) for today (partial, in progress) and yesterday.",
  inputSchema: getNutritionHistoryArgsSchema,
  async execute({ days }, { userId, today, timeZone, units }) {
    const [nutrition, latestCheckIn] = await Promise.all([
      getNutritionGrounding(userId, { today, days }),
      getLatestCheckIn(userId, { today, timeZone }),
    ]);
    const reference =
      latestCheckIn && latestCheckIn.daysAgo <= PROTEIN_REFERENCE_MAX_AGE_DAYS ? latestCheckIn : null;
    const referenceKg = reference?.weightKg ?? null;

    return {
      today,
      requestedDays: days,
      note: "Unlogged days have logged=false and null totals: they are missing data, not zero intake. Today is in progress and excluded from every average.",
      window: nutrition.window,
      windowAverages: nutrition.windowAverages,
      currentPeriod: {
        ...nutrition.currentPeriod,
        proteinGramsPerKg: proteinPerKg(nutrition.currentPeriod.averageProteinGrams, referenceKg),
      },
      previousPeriod: nutrition.previousPeriod,
      todayLog: dayDetail(nutrition.todayDetail),
      yesterdayLog: {
        ...dayDetail(nutrition.yesterdayDetail),
        proteinGramsPerKg: proteinPerKg(nutrition.yesterdayDetail.proteinGrams, referenceKg),
      },
      proteinReferenceWeight: reference
        ? { date: reference.date, weightKg: reference.weightKg, displayWeight: formatBodyWeight(reference.weightKg, units.bodyWeightUnit) }
        : null,
      proteinReferenceRule: `Protein per kg uses the latest check-in from the last ${PROTEIN_REFERENCE_MAX_AGE_DAYS} days; null when there is none.`,
    };
  },
};
