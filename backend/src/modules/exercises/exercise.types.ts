import { z } from "zod";
import {
  createExerciseSchema,
  exerciseSearchQuerySchema,
} from "./exercise.schemas.js";

export type CreateExerciseInput = z.infer<typeof createExerciseSchema>;

export type ExerciseSearchQuery = z.infer<typeof exerciseSearchQuerySchema>;

// userId is never exposed; isCustom distinguishes the user's private
// exercises from built-in FitAI exercises.
export interface ExerciseResponse {
  id: number;
  name: string;
  isCustom: boolean;
}

export interface FindOrCreateExerciseResult {
  exercise: ExerciseResponse;
  created: boolean;
}

export interface SeedBuiltInExercisesResult {
  total: number;
  created: number;
  updated: number;
  unchanged: number;
}
