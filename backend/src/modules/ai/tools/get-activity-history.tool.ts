import { z } from "zod";
import { getActivityGrounding } from "../../activity/activity.service.js";
import { TOOL_MAX_DAYS } from "../coach.limits.js";
import { capList, TOOL_OUTPUT_LIMITS } from "./tool.output.js";
import type { ToolDefinition } from "./tool.types.js";

const getActivityHistoryArgsSchema = z
  .object({
    days: z.number().finite().int().min(1).max(TOOL_MAX_DAYS),
  })
  .strict();

type GetActivityHistoryArgs = z.infer<typeof getActivityHistoryArgsSchema>;

export const getActivityHistoryTool: ToolDefinition<GetActivityHistoryArgs, unknown> = {
  name: "getActivityHistory",
  description:
    "Retrieve the user's logged daily activity (steps, walking distance in km, active calories) by logical day for the last `days` days, with backend-calculated averages over logged days and current vs previous rolling 7-day averages.",
  inputSchema: getActivityHistoryArgsSchema,
  async execute({ days }, { userId, today }) {
    const activity = await getActivityGrounding(userId, { today, days });
    const entries = capList(activity.window.entries, TOOL_OUTPUT_LIMITS.activityDays);

    return {
      today,
      requestedDays: days,
      note: "Only logged days are listed; a missing day is missing data, not zero activity.",
      window: { ...activity.window, entries: entries.items, totalEntries: entries.total, truncated: entries.truncated },
      currentPeriod: activity.currentPeriod,
      previousPeriod: activity.previousPeriod,
    };
  },
};
