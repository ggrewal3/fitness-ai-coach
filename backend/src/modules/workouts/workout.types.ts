import type { TrainingType } from "../../generated/prisma/client.js";
import { z } from "zod";
import {
  createWorkoutSessionSchema,
  updateWorkoutSessionSchema,
} from "./workout.schemas.js";

export type CreateWorkoutSessionInput = z.infer<
  typeof createWorkoutSessionSchema
>;

export type UpdateWorkoutSessionInput = z.infer<
  typeof updateWorkoutSessionSchema
>;

export interface WorkoutSessionResponse {
  id: number;
  trainingType: TrainingType;
  durationMinutes: number;
  notes: string | null;
  recordedAt: Date;
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
