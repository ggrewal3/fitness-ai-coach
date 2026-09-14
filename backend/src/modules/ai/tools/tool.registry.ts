import { getNutritionHistoryTool } from "./get-nutrition-history.tool.js";
import { getUserProfileTool } from "./get-user-profile.tool.js";
import { getWeightHistoryTool } from "./get-weight-history.tool.js";
import type { ToolDefinition } from "./tool.types.js";

const tools: ToolDefinition<unknown, unknown>[] = [
  getUserProfileTool,
  getWeightHistoryTool,
  getNutritionHistoryTool,
];

export function getRegisteredTools() {
  return tools;
}

export function getRegisteredTool(name: string) {
  return tools.find((tool) => tool.name === name);
}
