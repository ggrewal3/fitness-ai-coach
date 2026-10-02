import { z } from "zod";
import { getWorkoutGrounding } from "../../workouts/workout.service.js";
import type { WorkoutGroundingSession, WorkoutGroundingSet } from "../../workouts/workout.types.js";
import { TOOL_MAX_DAYS } from "../coach.limits.js";
import { capList, TOOL_OUTPUT_LIMITS, truncateText } from "./tool.output.js";
import type { ToolDefinition } from "./tool.types.js";

const getWorkoutHistoryArgsSchema = z
  .object({
    days: z.number().finite().int().min(1).max(TOOL_MAX_DAYS),
  })
  .strict();

type GetWorkoutHistoryArgs = z.infer<typeof getWorkoutHistoryArgsSchema>;

const name = (text: string) => truncateText(text, TOOL_OUTPUT_LIMITS.nameChars).text;

/** A set exactly as logged, compactly: "8 reps @ 100 kg", "10 reps @ bodyweight" (ADR-007: never converted). */
function formatSet(set: WorkoutGroundingSet): string {
  const reps = `${set.reps} ${set.reps === 1 ? "rep" : "reps"}`;
  return set.load === null || set.loadUnit === null
    ? `${reps} @ bodyweight`
    : `${reps} @ ${set.load} ${set.loadUnit.toLowerCase()}`;
}

/** Titles, notes and custom exercise names are user-authored: shortened data, never instructions. */
function sessionDetail(session: WorkoutGroundingSession) {
  const exercises = capList(session.exercises, TOOL_OUTPUT_LIMITS.exercisesPerSession);
  const notes = session.notes === null ? null : truncateText(session.notes, TOOL_OUTPUT_LIMITS.notesChars);

  return {
    date: session.date,
    title: name(session.title),
    trainingType: session.trainingType,
    durationMinutes: session.durationMinutes,
    notes: notes?.text ?? null,
    notesTruncated: notes?.truncated ?? false,
    totalExercises: exercises.total,
    exercisesTruncated: exercises.truncated,
    exercises: exercises.items.map((exercise) => {
      const sets = capList(exercise.sets, TOOL_OUTPUT_LIMITS.setsPerExercise);

      return {
        name: name(exercise.name),
        isCustom: exercise.isCustom,
        setCount: sets.total,
        setsTruncated: sets.truncated,
        sets: sets.items.map(formatSet),
      };
    }),
  };
}

export const getWorkoutHistoryTool: ToolDefinition<GetWorkoutHistoryArgs, unknown> = {
  name: "getWorkoutHistory",
  description:
    "Retrieve the user's workouts by logical training day: current vs previous rolling 7-day session counts, minutes and training types, per-exercise summaries over the last `days` days (top load reported separately per unit), and recent sessions with exercises, sets, reps and loads exactly as logged (newest first).",
  inputSchema: getWorkoutHistoryArgsSchema,
  async execute({ days }, { userId, today }) {
    const workouts = await getWorkoutGrounding(userId, { today, days });
    const sessions = capList(workouts.window.sessions, TOOL_OUTPUT_LIMITS.workoutSessions);
    const summaries = capList(workouts.exerciseSummaries, TOOL_OUTPUT_LIMITS.exerciseSummaries);

    const result = {
      today,
      requestedDays: days,
      note: "Loads are in the unit each set was logged in; kg and lb are never combined. Missing days are not proof of rest.",
      currentPeriod: workouts.currentPeriod,
      previousPeriod: workouts.previousPeriod,
      window: {
        startDate: workouts.window.startDate,
        endDate: workouts.window.endDate,
        totalSessions: sessions.total,
        sessionsTruncated: sessions.truncated,
        sessions: sessions.items.map(sessionDetail),
      },
      totalExercises: summaries.total,
      exerciseSummariesTruncated: summaries.truncated,
      exerciseSummaries: summaries.items.map((summary) => ({ ...summary, name: name(summary.name) })),
    };

    // Guarantee the budget: drop the oldest session details (periods and
    // exercise summaries still cover them) and say so.
    while (JSON.stringify(result).length > TOOL_OUTPUT_LIMITS.resultBudgetChars && result.window.sessions.length > 1) {
      result.window.sessions.pop();
      result.window.sessionsTruncated = true;
    }

    return result;
  },
};
