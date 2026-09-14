import { z } from "zod";
import { getNutritionHistorySummary } from "../../nutrition/nutrition.service.js";
import type { NutritionHistorySummaryResult } from "../../nutrition/nutrition.types.js";
import type { ToolDefinition } from "./tool.types.js";

const getNutritionHistoryArgsSchema = z
  .object({
    days: z.number().finite().int().min(1).max(365),
  })
  .strict();

type GetNutritionHistoryArgs = z.infer<typeof getNutritionHistoryArgsSchema>;

export const getNutritionHistoryTool: ToolDefinition<
  GetNutritionHistoryArgs,
  NutritionHistorySummaryResult
> = {
  name: "getNutritionHistory",
  description:
    "Retrieve the authenticated user's recent nutrition intake and backend-calculated calorie and macronutrient averages.",
  inputSchema: getNutritionHistoryArgsSchema,
  execute({ days }, { userId }) {
    return getNutritionHistorySummary(userId, days);
  },
};
