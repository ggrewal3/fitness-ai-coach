import { z } from "zod";
import {
  nutritionEstimateRequestSchema,
  nutritionEstimateResultSchema,
} from "./nutrition-estimate.schemas.js";

export type NutritionEstimateRequest = z.infer<
  typeof nutritionEstimateRequestSchema
>;

export type NutritionEstimateResult = z.infer<
  typeof nutritionEstimateResultSchema
>;
