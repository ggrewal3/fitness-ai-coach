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

export interface WorkoutTypeCounts {
  STRENGTH: number;
  CARDIO: number;
  MOBILITY: number;
  SPORT: number;
  OTHER: number;
}

/** A set exactly as stored: load and unit are never converted (ADR-007). */
export interface WorkoutGroundingSet {
  reps: number;
  load: number | null;
  loadUnit: LoadUnit | null;
}

export interface WorkoutGroundingExercise {
  exerciseId: number;
  name: string;
  isCustom: boolean;
  sets: WorkoutGroundingSet[];
}

export interface WorkoutGroundingSession {
  /** The logical training day (workoutDate). */
  date: string;
  title: string;
  trainingType: TrainingType;
  durationMinutes: number;
  notes: string | null;
  exercises: WorkoutGroundingExercise[];
}

export interface WorkoutGroundingPeriod {
  startDate: string;
  endDate: string;
  sessions: number;
  totalMinutes: number;
  sessionsByType: WorkoutTypeCounts;
}

/** Per exercise over the window; top loads are kept per unit, never combined. */
export interface WorkoutExerciseSummary {
  name: string;
  isCustom: boolean;
  sessions: number;
  totalSets: number;
  totalReps: number;
  topLoadKg: number | null;
  topLoadLb: number | null;
  lastPerformed: string;
}

export interface WorkoutGroundingResult {
  today: string;
  requestedDays: number;
  /** Sessions in the requested window, newest first. */
  window: { startDate: string; endDate: string; sessions: WorkoutGroundingSession[] };
  currentPeriod: WorkoutGroundingPeriod;
  previousPeriod: WorkoutGroundingPeriod;
  exerciseSummaries: WorkoutExerciseSummary[];
}
