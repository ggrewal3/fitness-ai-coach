import { getUserProfileTool } from "./get-user-profile.tool.js";

const tools = [getUserProfileTool] as const;

export function getRegisteredTools() {
  return tools;
}

export function getRegisteredTool(name: string) {
  return tools.find((tool) => tool.name === name);
}
