import type { ZodType } from "zod";

export interface ToolExecutionContext {
  userId: number;
}

export interface ToolDefinition<TArgs = unknown, TResult = unknown> {
  name: string;
  description: string;
  inputSchema: ZodType<TArgs>;
  execute(
    validatedArgs: TArgs,
    context: ToolExecutionContext
  ): Promise<TResult>;
}
