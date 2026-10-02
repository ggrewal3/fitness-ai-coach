import { z } from "zod";
import { formatBodyWeight, formatBodyWeightChange } from "../../../lib/units/displayUnits.js";
import { getWeightTrend } from "../../checkins/checkin.service.js";
import { TOOL_MAX_DAYS } from "../coach.limits.js";
import { capList, TOOL_OUTPUT_LIMITS } from "./tool.output.js";
import type { ToolDefinition } from "./tool.types.js";

const getWeightHistoryArgsSchema = z
  .object({
    days: z.number().finite().int().min(1).max(TOOL_MAX_DAYS),
  })
  .strict();

type GetWeightHistoryArgs = z.infer<typeof getWeightHistoryArgsSchema>;

export const getWeightHistoryTool: ToolDefinition<GetWeightHistoryArgs, unknown> = {
  name: "getWeightHistory",
  description:
    "Retrieve the user's body-weight trend: the latest check-in, backend-calculated averages for the current and previous rolling 7-day periods with a data-sufficiency verdict, and check-ins from the last `days` days (newest first).",
  inputSchema: getWeightHistoryArgsSchema,
  async execute({ days }, { userId, today, timeZone, units }) {
    const trend = await getWeightTrend(userId, { today, timeZone, days });
    const unit = units.bodyWeightUnit;
    const display = (kg: number | null) => (kg === null ? null : formatBodyWeight(kg, unit));
    const period = (value: typeof trend.currentPeriod) => ({
      ...value,
      displayAverageWeight: display(value.averageWeightKg),
    });
    const checkIns = capList(trend.history.checkIns, TOOL_OUTPUT_LIMITS.weightCheckIns);

    return {
      today,
      requestedDays: days,
      latestCheckIn: trend.latestCheckIn
        ? { ...trend.latestCheckIn, displayWeight: display(trend.latestCheckIn.weightKg) }
        : null,
      currentPeriod: period(trend.currentPeriod),
      previousPeriod: period(trend.previousPeriod),
      comparison: {
        ...trend.comparison,
        displayAverageChange:
          trend.comparison.averageChangeKg === null ? null : formatBodyWeightChange(trend.comparison.averageChangeKg, unit),
      },
      history: {
        startDate: trend.history.startDate,
        endDate: trend.history.endDate,
        totalCheckIns: checkIns.total,
        truncated: checkIns.truncated,
        checkIns: checkIns.items.map((checkIn) => ({ ...checkIn, displayWeight: display(checkIn.weightKg) })),
      },
    };
  },
};
