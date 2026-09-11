import { getUserProfileTool } from "./get-user-profile.tool.js";
import { getWeightHistoryTool } from "./get-weight-history.tool.js";
import type { ToolDefinition } from "./tool.types.js";

const tools: ToolDefinition<unknown, unknown>[] = [
  getUserProfileTool,
  getWeightHistoryTool,
];

export function getRegisteredTools() {
  return tools;
}

export function getRegisteredTool(name: string) {
  return tools.find((tool) => tool.name === name);
}
