import type { ZodType } from "zod";

export interface ModelToolDefinition {
  name: string;
  description: string;
  inputSchema: ZodType;
}

export interface ModelToolCall {
  id: string;
  name: string;
  /** Parsed JSON arguments; validated by the orchestrator, never trusted. */
  arguments: unknown;
  /** True when the provider's argument text was not valid JSON. */
  malformed?: boolean;
}

export interface ModelToolResult {
  callId: string;
  output: unknown;
}

/** An earlier conversation turn, as plain text (client-supplied, untrusted). */
export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ModelSessionRequest<T> {
  systemPrompt: string;
  /** Earlier turns, oldest first; never includes the current message. */
  history?: readonly ConversationTurn[];
  userMessage: string;
  schemaName: string;
  responseSchema: ZodType<T>;
  tools: readonly ModelToolDefinition[];
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface ModelFinalTurn {
  type: "final";
  /** Parsed structured output; validated by the orchestrator. Undefined if unparseable. */
  output: unknown;
  /** True when the model refused instead of answering. */
  refusal?: boolean;
  model: string;
  providerRequestId: string;
  usage?: TokenUsage;
}

export interface ModelToolCallTurn {
  type: "tool_calls";
  toolCalls: ModelToolCall[];
  model: string;
  providerRequestId: string;
  usage?: TokenUsage;
}

export type ModelTurn = ModelFinalTurn | ModelToolCallTurn;

/** Per-call options; `signal` aborts the provider call (request deadline). */
export interface ModelCallOptions {
  signal?: AbortSignal;
}

export interface ModelProviderSession<T> {
  next(options?: ModelCallOptions): Promise<ModelTurn>;
  submitToolResults(results: readonly ModelToolResult[], options?: ModelCallOptions): Promise<ModelTurn>;
}

export interface ModelProvider {
  readonly name: string;
  readonly model: string;

  createSession<T>(
    request: ModelSessionRequest<T>
  ): ModelProviderSession<T>;
}

/** Provider failure categories, for logs only (never shown to users). */
export type ModelProviderErrorCategory = "not_configured" | "timeout" | "aborted" | "provider_error";

export class ModelProviderError extends Error {
  readonly category: ModelProviderErrorCategory;

  constructor(message = "Model provider request failed.", category: ModelProviderErrorCategory = "provider_error") {
    super(message);
    this.name = "ModelProviderError";
    this.category = category;
  }
}

export class ModelOutputValidationError extends Error {
  constructor() {
    super("Model returned invalid structured output.");
    this.name = "ModelOutputValidationError";
  }
}
