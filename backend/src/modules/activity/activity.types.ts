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

export interface ActivityHistoryEntry {
  steps: number;
  walkingDistanceKm: number | null;
  activeCalories: number | null;
  source: ActivitySource;
  recordedAt: Date;
}

export interface ActivityHistorySummary {
  averageSteps: number;
  totalSteps: number;
  averageWalkingDistanceKm: number | null;
  averageActiveCalories: number | null;
  totalLoggedDays: number;
  latestSteps: number;
}

export interface ActivityHistorySummaryResult {
  found: boolean;
  requestedDays: number;
  summary: ActivityHistorySummary | null;
  entries: ActivityHistoryEntry[];
}
