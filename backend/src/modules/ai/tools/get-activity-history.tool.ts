import { z } from "zod";
import { getActivityHistorySummary } from "../../activity/activity.service.js";
import type { ActivityHistorySummaryResult } from "../../activity/activity.types.js";
import type { ToolDefinition } from "./tool.types.js";

const getActivityHistoryArgsSchema = z
  .object({
    days: z.number().finite().int().min(1).max(365),
  })
  .strict();

type GetActivityHistoryArgs = z.infer<typeof getActivityHistoryArgsSchema>;

export const getActivityHistoryTool: ToolDefinition<
  GetActivityHistoryArgs,
  ActivityHistorySummaryResult
> = {
  name: "getActivityHistory",
  description:
    "Retrieve the authenticated user's recent daily activity, including step history, available walking-distance and active-calorie information, and backend-calculated activity averages.",
  inputSchema: getActivityHistoryArgsSchema,
  execute({ days }, { userId }) {
    return getActivityHistorySummary(userId, days);
  },
};
