import type { ZodType } from "zod";

export interface ModelToolDefinition {
  name: string;
  description: string;
  inputSchema: ZodType;
}

export interface ModelToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export interface ModelToolResult {
  callId: string;
  output: unknown;
}

export interface ModelSessionRequest<T> {
  systemPrompt: string;
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
  output: unknown;
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

export interface ModelProviderSession<T> {
  next(): Promise<ModelTurn>;
  submitToolResults(results: readonly ModelToolResult[]): Promise<ModelTurn>;
}

export interface ModelProvider {
  readonly name: string;
  readonly model: string;

  createSession<T>(
    request: ModelSessionRequest<T>
  ): ModelProviderSession<T>;
}

export class ModelProviderError extends Error {
  constructor(message = "Model provider request failed.") {
    super(message);
    this.name = "ModelProviderError";
  }
}

export class ModelOutputValidationError extends Error {
  constructor() {
    super("Model returned invalid structured output.");
    this.name = "ModelOutputValidationError";
  }
}
