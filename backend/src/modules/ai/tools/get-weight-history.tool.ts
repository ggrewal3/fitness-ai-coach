import { z } from "zod";
import { getWeightHistorySummary } from "../../checkins/checkin.service.js";
import type { WeightHistorySummaryResult } from "../../checkins/checkin.types.js";
import type { ToolDefinition } from "./tool.types.js";

const getWeightHistoryArgsSchema = z
  .object({
    days: z.number().finite().int().min(1).max(365),
  })
  .strict();

type GetWeightHistoryArgs = z.infer<typeof getWeightHistoryArgsSchema>;

export const getWeightHistoryTool: ToolDefinition<
  GetWeightHistoryArgs,
  WeightHistorySummaryResult
> = {
  name: "getWeightHistory",
  description:
    "Retrieve the authenticated user's recent weight measurements and backend-calculated weight trend metrics.",
  inputSchema: getWeightHistoryArgsSchema,
  execute({ days }, { userId }) {
    return getWeightHistorySummary(userId, days);
  },
};
