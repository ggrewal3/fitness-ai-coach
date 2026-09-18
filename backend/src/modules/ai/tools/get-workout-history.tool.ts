import { z } from "zod";
import { getWorkoutHistorySummary } from "../../workouts/workout.service.js";
import type { WorkoutHistorySummaryResult } from "../../workouts/workout.types.js";
import type { ToolDefinition } from "./tool.types.js";

const getWorkoutHistoryArgsSchema = z
  .object({
    days: z.number().finite().int().min(1).max(365),
  })
  .strict();

type GetWorkoutHistoryArgs = z.infer<typeof getWorkoutHistoryArgsSchema>;

export const getWorkoutHistoryTool: ToolDefinition<
  GetWorkoutHistoryArgs,
  WorkoutHistorySummaryResult
> = {
  name: "getWorkoutHistory",
  description:
    "Retrieve the authenticated user's recent workout history, including session counts, training duration, training-type distribution, latest workout information, and recent workout entries.",
  inputSchema: getWorkoutHistoryArgsSchema,
  execute({ days }, { userId }) {
    return getWorkoutHistorySummary(userId, days);
  },
};
