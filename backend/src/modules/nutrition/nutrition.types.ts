import { z } from "zod";
import {
  createNutritionEntrySchema,
  updateNutritionEntrySchema,
} from "./nutrition.schemas.js";

export type CreateNutritionEntryInput = z.infer<
  typeof createNutritionEntrySchema
>;

export type UpdateNutritionEntryInput = z.infer<
  typeof updateNutritionEntrySchema
>;

export interface NutritionEntryResponse {
  id: number;
  calories: number;
  proteinGrams: number;
  carbsGrams: number;
  fatGrams: number;
  recordedAt: Date;
  createdAt: Date;
  updatedAt: Date;
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
