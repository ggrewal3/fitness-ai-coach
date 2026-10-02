// User-facing provenance for coach answers (ADR-026): which kinds of the
// user's data the coach actually reviewed, and for which period.
//
// Derived deterministically from successful tool runs, never from the model.
// The period is the window each tool was asked to review (`days` ending
// today); comparison periods and reference lookups a tool reads internally
// (e.g. a recent check-in for protein per kg) do not widen it.
import { addDays, type CalendarDate } from "../../lib/dates/calendarDate.js";

export type CoachSourceType = "profile" | "weight" | "nutrition" | "activity" | "workouts";

export interface CoachSource {
  type: CoachSourceType;
  /** Inclusive dates in the user's calendar; null for the profile. */
  startDate: CalendarDate | null;
  endDate: CalendarDate | null;
}

/** A tool that ran successfully (failed, invalid, rejected or oversized calls are never recorded). */
export interface SuccessfulToolUse {
  name: string;
  days: number | null;
}

/** Public categories, so internal tool names never leave the server. */
const SOURCE_TYPE_BY_TOOL: Record<string, CoachSourceType> = {
  getUserProfile: "profile",
  getWeightHistory: "weight",
  getNutritionHistory: "nutrition",
  getActivityHistory: "activity",
  getWorkoutHistory: "workouts",
};

/**
 * One source per type, in order of first use. Several windows of one type
 * merge into one period (all windows end today, so the merge is the widest).
 */
export function deriveSources(toolsUsed: readonly SuccessfulToolUse[], today: CalendarDate): CoachSource[] {
  const sources = new Map<CoachSourceType, CoachSource>();

  for (const tool of toolsUsed) {
    const type = SOURCE_TYPE_BY_TOOL[tool.name];

    if (!type) {
      continue;
    }

    const startDate = tool.days === null ? null : addDays(today, -(tool.days - 1));
    const existing = sources.get(type);

    if (!existing) {
      sources.set(type, { type, startDate, endDate: startDate === null ? null : today });
    } else if (startDate !== null && (existing.startDate === null || startDate < existing.startDate)) {
      existing.startDate = startDate;
      existing.endDate = today;
    }
  }

  return [...sources.values()];
}
