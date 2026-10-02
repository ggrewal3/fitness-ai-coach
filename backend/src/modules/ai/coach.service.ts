import { randomUUID } from "node:crypto";
import { getUnitPreferences } from "../account/account.service.js";
import { COACH_LIMITS, type CoachLimits } from "./coach.limits.js";
import { buildCoachSystemPrompt, COACH_PROMPT_VERSION } from "./coach.prompts.js";
import { coachResponseSchema } from "./coach.schemas.js";
import { deriveSources, type CoachSource, type SuccessfulToolUse } from "./coach.sources.js";
import type { CoachRequest, CoachResponse } from "./coach.types.js";
import {
  ModelOutputValidationError,
  ModelProviderError,
  type ModelProvider,
  type ModelToolCall,
  type ModelToolResult,
  type ModelTurn,
  type TokenUsage,
} from "./model.provider.js";
import { OpenAIProvider } from "./openai.provider.js";
import { getRegisteredTool, getRegisteredTools } from "./tools/tool.registry.js";
import type { ToolExecutionContext } from "./tools/tool.types.js";

/** The whole request exceeded COACH_LIMITS.requestDeadlineMs (504). */
export class CoachDeadlineError extends Error {
  constructor() {
    super("AI Coach request deadline exceeded.");
    this.name = "CoachDeadlineError";
  }
}

/** The model still wanted tools on the last permitted turn (502). */
export class CoachTurnLimitError extends Error {
  constructor() {
    super("AI Coach exceeded its model-turn limit.");
    this.name = "CoachTurnLimitError";
  }
}

/** The model refused; reported to users like any invalid output (502). */
class ModelRefusalError extends ModelOutputValidationError {}

/** A tool that ran successfully: the internal record sources are derived from. */
export type CoachToolUse = SuccessfulToolUse;

export interface CoachRunResult {
  response: CoachResponse;
  /** Successful tool runs, in order (internal; tool names never leave the server). */
  toolsUsed: CoachToolUse[];
  /** Public provenance derived from toolsUsed (ADR-026). */
  sources: CoachSource[];
}

type ToolOutcome = "ok" | "cached" | "unknown_tool" | "invalid_arguments" | "error" | "too_large" | "turn_cap" | "request_cap";

const TOOL_ERRORS = {
  unavailable: "Tool unavailable.",
  invalidArguments: "Invalid tool arguments.",
  tooLarge: "Tool result too large. Request a shorter period.",
  turnCap: "Too many tool calls in one turn. Use the results already returned.",
  requestCap: "Tool call limit reached for this request. Answer with the data already retrieved.",
} as const;

let modelProvider: ModelProvider | undefined;

function getModelProvider(): ModelProvider {
  if (!modelProvider) {
    modelProvider = new OpenAIProvider();
  }

  return modelProvider;
}

/** Replaces the model provider (tests use a scripted fake); undefined restores OpenAI. */
export function setModelProvider(provider: ModelProvider | undefined): void {
  modelProvider = provider;
}

function addUsage(total: TokenUsage | undefined, usage: TokenUsage | undefined): TokenUsage | undefined {
  if (!usage) return total;
  return {
    inputTokens: (total?.inputTokens ?? 0) + usage.inputTokens,
    outputTokens: (total?.outputTokens ?? 0) + usage.outputTokens,
    totalTokens: (total?.totalTokens ?? 0) + usage.totalTokens,
  };
}

function failureCategory(error: unknown): string {
  if (error instanceof CoachDeadlineError) return "deadline";
  if (error instanceof CoachTurnLimitError) return "turn_limit";
  if (error instanceof ModelRefusalError) return "refusal";
  if (error instanceof ModelOutputValidationError) return "invalid_output";
  if (error instanceof ModelProviderError) return error.category;
  return "internal";
}

/**
 * Runs the grounded coach loop (ADR-019):
 *
 * - at most `maxModelTurns` provider calls; a final answer on the last one is
 *   accepted, a further tool request fails with CoachTurnLimitError;
 * - at most `maxToolCallsPerTurn` / `maxToolCallsPerRequest` tool calls; extra
 *   calls get an error result so the model can still answer;
 * - unknown tools, malformed or invalid arguments, failures and oversized
 *   results become `{ error }` results, never exceptions;
 * - identical calls in one request reuse the first result;
 * - the whole request is bounded by `requestDeadlineMs` (CoachDeadlineError).
 *
 * Logs metadata only: never the message, tool output or answer.
 * `limits` overrides exist for tests.
 */
export async function generateCoachResponse(
  userId: number,
  request: CoachRequest,
  options: { limits?: Partial<CoachLimits> } = {}
): Promise<CoachRunResult> {
  const limits: CoachLimits = { ...COACH_LIMITS, ...options.limits };
  const requestId = randomUUID();
  const startedAt = Date.now();
  const deadline = new AbortController();
  const deadlineTimer = setTimeout(() => deadline.abort(), limits.requestDeadlineMs);
  const deadlineReached = new Promise<never>((_resolve, reject) => {
    deadline.signal.addEventListener("abort", () => reject(new CoachDeadlineError()), { once: true });
  });
  deadlineReached.catch(() => undefined);

  // Every awaited step races the deadline, even if a provider ignores `signal`.
  const withinDeadline = async <T>(work: () => Promise<T>): Promise<T> => {
    if (deadline.signal.aborted) throw new CoachDeadlineError();
    try {
      return await Promise.race([work(), deadlineReached]);
    } catch (error) {
      throw deadline.signal.aborted ? new CoachDeadlineError() : error;
    }
  };

  // Earlier turns are untrusted conversational context (ADR-026): they reach
  // the model, but tools still read the facts. Only their size is logged.
  const history = request.history ?? [];
  const historyMetrics = {
    historyMessages: history.length,
    historyChars: history.reduce((sum, turn) => sum + turn.content.length, 0),
    hasHistory: history.length > 0,
  };
  let model = "unknown";
  let usage: TokenUsage | undefined;
  let modelTurns = 0;
  let toolCallCount = 0;
  const toolsUsed: CoachToolUse[] = [];
  const cache = new Map<string, unknown>();

  try {
    const units = await withinDeadline(() => getUnitPreferences(userId));
    const context: ToolExecutionContext = {
      userId,
      today: request.clientContext.today,
      timeZone: request.clientContext.timeZone,
      units: { bodyWeightUnit: units.bodyWeightUnit, heightUnit: units.heightUnit },
    };
    const provider = getModelProvider();
    const session = provider.createSession({
      systemPrompt: buildCoachSystemPrompt(context),
      history,
      userMessage: request.message,
      schemaName: "coach_response",
      responseSchema: coachResponseSchema,
      tools: getRegisteredTools().map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
    });

    const callModel = async (call: () => Promise<ModelTurn>): Promise<ModelTurn> => {
      const turn = await withinDeadline(call);
      modelTurns += 1;
      model = turn.model;
      usage = addUsage(usage, turn.usage);
      return turn;
    };

    const runTool = async (call: ModelToolCall, callsThisTurn: number): Promise<{ output: unknown; outcome: ToolOutcome }> => {
      if (callsThisTurn >= limits.maxToolCallsPerTurn) return { output: { error: TOOL_ERRORS.turnCap }, outcome: "turn_cap" };
      if (toolCallCount >= limits.maxToolCallsPerRequest) return { output: { error: TOOL_ERRORS.requestCap }, outcome: "request_cap" };
      toolCallCount += 1;

      const tool = getRegisteredTool(call.name);
      if (!tool) return { output: { error: TOOL_ERRORS.unavailable }, outcome: "unknown_tool" };

      const parsed = call.malformed ? null : tool.inputSchema.safeParse(call.arguments);
      if (!parsed?.success) return { output: { error: TOOL_ERRORS.invalidArguments }, outcome: "invalid_arguments" };

      const cacheKey = `${tool.name}:${JSON.stringify(parsed.data)}`;
      if (cache.has(cacheKey)) return { output: cache.get(cacheKey), outcome: "cached" };

      let output: unknown;
      try {
        output = await withinDeadline(() => tool.execute(parsed.data, context));
      } catch (error) {
        if (error instanceof CoachDeadlineError) throw error;
        return { output: { error: TOOL_ERRORS.unavailable }, outcome: "error" };
      }

      if (JSON.stringify(output).length > limits.maxToolResultChars) {
        return { output: { error: TOOL_ERRORS.tooLarge }, outcome: "too_large" };
      }

      cache.set(cacheKey, output);
      const days = (parsed.data as { days?: unknown }).days;
      toolsUsed.push({ name: tool.name, days: typeof days === "number" ? days : null });
      return { output, outcome: "ok" };
    };

    let turn = await callModel(() => session.next({ signal: deadline.signal }));

    while (turn.type === "tool_calls") {
      if (modelTurns >= limits.maxModelTurns) {
        throw new CoachTurnLimitError();
      }

      const results: ModelToolResult[] = [];
      let callsThisTurn = 0;

      for (const call of turn.toolCalls) {
        const toolStartedAt = Date.now();
        const { output, outcome } = await runTool(call, callsThisTurn);
        if (outcome !== "turn_cap" && outcome !== "request_cap") callsThisTurn += 1;
        const registered = getRegisteredTool(call.name);
        const days = (call.arguments as { days?: unknown } | undefined)?.days;

        console.info({
          event: "ai.tool.completed",
          requestId,
          userId,
          toolName: registered ? registered.name : "unknown",
          days: typeof days === "number" ? days : null,
          outcome,
          success: outcome === "ok" || outcome === "cached",
          latencyMs: Date.now() - toolStartedAt,
        });

        results.push({ callId: call.id, output });
      }

      turn = await callModel(() => session.submitToolResults(results, { signal: deadline.signal }));
    }

    if (turn.refusal) {
      throw new ModelRefusalError();
    }

    const parsedResponse = coachResponseSchema.safeParse(turn.output);
    if (!parsedResponse.success) {
      throw new ModelOutputValidationError();
    }

    const sources = deriveSources(toolsUsed, context.today);

    console.info({
      event: "ai.coach.completed",
      requestId,
      userId,
      model,
      promptVersion: COACH_PROMPT_VERSION,
      latencyMs: Date.now() - startedAt,
      modelTurns,
      toolCallCount,
      toolNames: [...new Set(toolsUsed.map((tool) => tool.name))],
      sourceTypes: sources.map((source) => source.type),
      ...historyMetrics,
      usage,
      success: true,
    });

    return { response: parsedResponse.data, toolsUsed, sources };
  } catch (error) {
    console.error({
      event: "ai.coach.completed",
      requestId,
      userId,
      model,
      promptVersion: COACH_PROMPT_VERSION,
      latencyMs: Date.now() - startedAt,
      modelTurns,
      toolCallCount,
      toolNames: [...new Set(toolsUsed.map((tool) => tool.name))],
      ...historyMetrics,
      usage,
      success: false,
      failureCategory: failureCategory(error),
      turnLimitReached: error instanceof CoachTurnLimitError,
      deadlineReached: error instanceof CoachDeadlineError,
    });

    throw error;
  } finally {
    clearTimeout(deadlineTimer);
  }
}
