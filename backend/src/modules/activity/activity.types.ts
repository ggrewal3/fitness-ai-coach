import type { ActivitySource } from "../../generated/prisma/client.js";
import {
  createDailyActivitySchema,
  updateDailyActivitySchema,
} from "./activity.schemas.js";
import { z } from "zod";

export type CreateDailyActivityInput = z.infer<
  typeof createDailyActivitySchema
>;

export type UpdateDailyActivityInput = z.infer<
  typeof updateDailyActivitySchema
>;

export interface DailyActivityResponse {
  id: number;
  steps: number;
  walkingDistanceKm: number | null;
  activeCalories: number | null;
  source: ActivitySource;
  recordedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

/** One logged activity day (activityDate). */
export interface ActivityGroundingEntry {
  date: string;
  steps: number;
  walkingDistanceKm: number | null;
  activeCalories: number | null;
}

/** Averages over logged days only; null when nothing is logged. */
export interface ActivityAverages {
  loggedDays: number;
  averageSteps: number | null;
  averageWalkingDistanceKm: number | null;
  averageActiveCalories: number | null;
}

export interface ActivityGroundingResult {
  today: string;
  requestedDays: number;
  /** Logged days in the requested window, newest first. */
  window: { startDate: string; endDate: string; entries: ActivityGroundingEntry[] } & ActivityAverages;
  currentPeriod: { startDate: string; endDate: string } & ActivityAverages;
  previousPeriod: { startDate: string; endDate: string } & ActivityAverages;
}
