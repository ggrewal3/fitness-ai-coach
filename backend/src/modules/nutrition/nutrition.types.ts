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

/** One logical day (entryDate). Totals are null when nothing was logged. */
export interface NutritionGroundingDay {
  date: string;
  logged: boolean;
  itemCount: number;
  calories: number | null;
  proteinGrams: number | null;
  carbsGrams: number | null;
  fatGrams: number | null;
}

/** Averages over logged days only; null when no day was logged. */
export interface NutritionAverages {
  loggedDays: number;
  averageCalories: number | null;
  averageProteinGrams: number | null;
  averageCarbsGrams: number | null;
  averageFatGrams: number | null;
}

export interface NutritionGroundingFood {
  foodName: string;
  quantity: number;
  unit: string;
  mealType: MealType;
  calories: number;
  proteinGrams: number;
  carbsGrams: number;
  fatGrams: number;
}

export interface NutritionGroundingDetail extends NutritionGroundingDay {
  /** True for today: the day is still in progress. */
  isPartialDay: boolean;
  foods: NutritionGroundingFood[];
}

export interface NutritionGroundingResult {
  today: string;
  requestedDays: number;
  /** Every date in the requested window, newest first. */
  window: { startDate: string; endDate: string; days: NutritionGroundingDay[] };
  /** Completed days only (today is excluded). */
  windowAverages: NutritionAverages;
  currentPeriod: { startDate: string; endDate: string } & NutritionAverages;
  previousPeriod: { startDate: string; endDate: string } & NutritionAverages;
  todayDetail: NutritionGroundingDetail;
  yesterdayDetail: NutritionGroundingDetail;
}
