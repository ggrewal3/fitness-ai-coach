import type { LoadUnit, TrainingType } from "../../generated/prisma/client.js";
import { z } from "zod";
import type { ExerciseResponse } from "../exercises/exercise.types.js";
import {
  createWorkoutSessionSchema,
  updateWorkoutSessionSchema,
  workoutListQuerySchema,
} from "./workout.schemas.js";

export type CreateWorkoutSessionInput = z.infer<
  typeof createWorkoutSessionSchema
>;

export type UpdateWorkoutSessionInput = z.infer<
  typeof updateWorkoutSessionSchema
>;

export type WorkoutExerciseInput = CreateWorkoutSessionInput["exercises"][number];

export type WorkoutListQuery = z.infer<typeof workoutListQuerySchema>;

export interface WorkoutSetResponse {
  id: number;
  position: number;
  reps: number;
  // Serialized as a JSON number (at most 2 decimals), never a Decimal string.
  load: number | null;
  loadUnit: LoadUnit | null;
}

export interface WorkoutExerciseResponse {
  id: number;
  position: number;
  exercise: ExerciseResponse;
  sets: WorkoutSetResponse[];
}

interface WorkoutSessionFields {
  id: number;
  title: string;
  workoutDate: string; // "YYYY-MM-DD"
  trainingType: TrainingType;
  durationMinutes: number;
  notes: string | null;
  recordedAt: Date;
}

export interface WorkoutDetailResponse extends WorkoutSessionFields {
  exercises: WorkoutExerciseResponse[];
}

export interface WorkoutSummaryResponse extends WorkoutSessionFields {
  exerciseCount: number;
  setCount: number;
}

export interface WorkoutHistoryEntry {
  trainingType: TrainingType;
  durationMinutes: number;
  notes: string | null;
  recordedAt: Date;
}

export interface WorkoutTypeCounts {
  STRENGTH: number;
  CARDIO: number;
  MOBILITY: number;
  SPORT: number;
  OTHER: number;
}

export interface WorkoutHistorySummary {
  totalSessions: number;
  totalTrainingMinutes: number;
  averageDurationMinutes: number;
  sessionsByType: WorkoutTypeCounts;
  latestTrainingType: TrainingType;
  latestDurationMinutes: number;
  latestRecordedAt: Date;
}

export interface WorkoutHistorySummaryResult {
  found: boolean;
  requestedDays: number;
  summary: WorkoutHistorySummary | null;
  entries: WorkoutHistoryEntry[];
}
