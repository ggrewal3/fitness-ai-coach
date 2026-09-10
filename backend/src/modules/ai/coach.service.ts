import { coachResponseSchema } from "./coach.schemas.js";
import { COACH_PROMPT_VERSION, COACH_SYSTEM_PROMPT } from "./coach.prompts.js";
import {
  ModelOutputValidationError,
  ModelProviderError,
  type ModelProvider,
} from "./model.provider.js";
import { OpenAIProvider } from "./openai.provider.js";
import {
  getRegisteredTool,
  getRegisteredTools,
} from "./tools/tool.registry.js";
import type { CoachRequest, CoachResponse } from "./coach.types.js";

const MAX_MODEL_TOOL_ITERATIONS = 5;

let modelProvider: ModelProvider | undefined;

function getModelProvider() {
  if (!modelProvider) {
    modelProvider = new OpenAIProvider();
  }

  return modelProvider;
}

export async function generateCoachResponse(
  userId: number,
  request: CoachRequest
): Promise<CoachResponse> {
  const startedAt = Date.now();
  let model = "unknown";
  let totalUsage:
    | { inputTokens: number; outputTokens: number; totalTokens: number }
    | undefined;

  try {
    const provider = getModelProvider();
    const tools = getRegisteredTools();
    const session = provider.createSession({
      systemPrompt: COACH_SYSTEM_PROMPT,
      userMessage: request.message,
      schemaName: "coach_response",
      responseSchema: coachResponseSchema,
      tools: tools.map(({ name, description, inputSchema }) => ({
        name,
        description,
        inputSchema,
      })),
    });

    let turn = await session.next();

    for (let iteration = 0; iteration < MAX_MODEL_TOOL_ITERATIONS; iteration += 1) {
      model = turn.model;
      if (turn.usage) {
        totalUsage = {
          inputTokens: (totalUsage?.inputTokens ?? 0) + turn.usage.inputTokens,
          outputTokens:
            (totalUsage?.outputTokens ?? 0) + turn.usage.outputTokens,
          totalTokens: (totalUsage?.totalTokens ?? 0) + turn.usage.totalTokens,
        };
      }

      if (turn.type === "final") {
        const parsedResponse = coachResponseSchema.safeParse(turn.output);

        if (!parsedResponse.success) {
          throw new ModelOutputValidationError();
        }

        console.info({
          event: "ai.coach.completed",
          userId,
          model,
          promptVersion: COACH_PROMPT_VERSION,
          latencyMs: Date.now() - startedAt,
          usage: totalUsage,
          success: true,
        });

        return parsedResponse.data;
      }

      const toolResults = [];

      for (const toolCall of turn.toolCalls) {
        const toolStartedAt = Date.now();
        const tool = getRegisteredTool(toolCall.name);

        console.info({
          event: "ai.tool.called",
          userId,
          toolName: toolCall.name,
        });

        if (!tool) {
          console.info({
            event: "ai.tool.completed",
            userId,
            toolName: toolCall.name,
            latencyMs: Date.now() - toolStartedAt,
            success: false,
          });

          toolResults.push({
            callId: toolCall.id,
            output: { error: "Tool unavailable." },
          });
          continue;
        }

        const parsedArguments = tool.inputSchema.safeParse(toolCall.arguments);

        if (!parsedArguments.success) {
          console.info({
            event: "ai.tool.completed",
            userId,
            toolName: tool.name,
            latencyMs: Date.now() - toolStartedAt,
            success: false,
          });

          toolResults.push({
            callId: toolCall.id,
            output: { error: "Invalid tool arguments." },
          });
          continue;
        }

        try {
          const output = await tool.execute(parsedArguments.data, { userId });

          console.info({
            event: "ai.tool.completed",
            userId,
            toolName: tool.name,
            latencyMs: Date.now() - toolStartedAt,
            success: true,
          });

          toolResults.push({
            callId: toolCall.id,
            output,
          });
        } catch {
          console.info({
            event: "ai.tool.completed",
            userId,
            toolName: tool.name,
            latencyMs: Date.now() - toolStartedAt,
            success: false,
          });

          toolResults.push({
            callId: toolCall.id,
            output: { error: "Tool unavailable." },
          });
        }
      }

      turn = await session.submitToolResults(toolResults);
    }

    throw new ModelProviderError();
  } catch (error) {
    console.error({
      event: "ai.coach.completed",
      userId,
      model,
      promptVersion: COACH_PROMPT_VERSION,
      latencyMs: Date.now() - startedAt,
      usage: totalUsage,
      success: false,
    });

    throw error;
  }
}
