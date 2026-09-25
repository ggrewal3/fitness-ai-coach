import type { MealType, NutritionSource } from "../../generated/prisma/client.js";
import { z } from "zod";
import {
  createNutritionFoodItemSchema,
  updateNutritionFoodItemSchema,
} from "./nutrition.schemas.js";

export type CreateNutritionFoodItemInput = z.infer<
  typeof createNutritionFoodItemSchema
>;

export type UpdateNutritionFoodItemInput = z.infer<
  typeof updateNutritionFoodItemSchema
>;

export interface NutritionFoodItemResponse {
  id: number;
  foodName: string;
  quantity: number;
  unit: string;
  calories: number;
  proteinGrams: number;
  carbsGrams: number;
  fatGrams: number;
  mealType: MealType;
  source: NutritionSource;
  entryDate: Date;
  recordedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

// Derived aggregate for a single logical nutrition day - never stored, always
// computed from NutritionFoodItem rows. `found` is false when no food items
// were logged for entryDate; totals are 0 in that case and must be read as
// "no data", not as zero calories actually consumed.
export interface DailyNutritionSummary {
  entryDate: string;
  found: boolean;
  totalCalories: number;
  totalProteinGrams: number;
  totalCarbsGrams: number;
  totalFatGrams: number;
  numberOfFoodItems: number;
}

export interface NutritionHistoryEntry {
  calories: number;
  proteinGrams: number;
  carbsGrams: number;
  fatGrams: number;
  recordedAt: Date;
}

export interface NutritionHistorySummary {
  averageCalories: number;
  averageProteinGrams: number;
  averageCarbsGrams: number;
  averageFatGrams: number;
  totalLoggedDays: number;
  latestCalories: number;
  latestProteinGrams: number;
}

export interface NutritionHistorySummaryResult {
  found: boolean;
  requestedDays: number;
  summary: NutritionHistorySummary | null;
  entries: NutritionHistoryEntry[];
}
