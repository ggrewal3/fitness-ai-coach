import OpenAI from "openai";
import {
  zodResponsesFunction,
  zodTextFormat,
} from "openai/helpers/zod";
import type {
  FunctionTool,
  ResponseFormatTextJSONSchemaConfig,
  ResponseInputItem,
} from "openai/resources/responses/responses.js";
import { PROVIDER_MAX_RETRIES, PROVIDER_TIMEOUT_MS } from "./coach.limits.js";
import {
  ModelProviderError,
  type ModelCallOptions,
  type ModelProvider,
  type ModelProviderSession,
  type ModelSessionRequest,
  type ModelToolCall,
  type ModelToolResult,
  type ModelTurn,
} from "./model.provider.js";

export class OpenAIProvider implements ModelProvider {
  readonly name = "openai";
  readonly model: string;

  private readonly client: OpenAI;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL;

    if (!apiKey || !model) {
      throw new ModelProviderError("OpenAI provider is not configured.", "not_configured");
    }

    // Explicit, so one slow call cannot hold a request for the SDK's
    // 10-minute default; the coach also enforces an overall deadline.
    this.client = new OpenAI({ apiKey, timeout: PROVIDER_TIMEOUT_MS, maxRetries: PROVIDER_MAX_RETRIES });
    this.model = model;
  }

  createSession<T>(
    request: ModelSessionRequest<T>
  ): ModelProviderSession<T> {
    return new OpenAIProviderSession(this.client, this.model, request);
  }
}

/** Plain JSON tool and format definitions: the SDK's auto-parsing would throw on bad arguments. */
function toolDefinition(tool: ModelSessionRequest<unknown>["tools"][number]): FunctionTool {
  const parseable = zodResponsesFunction({ name: tool.name, description: tool.description, parameters: tool.inputSchema });
  return {
    type: "function",
    name: parseable.name,
    description: parseable.description,
    parameters: parseable.parameters,
    strict: parseable.strict,
  };
}

function textFormat(request: ModelSessionRequest<unknown>): ResponseFormatTextJSONSchemaConfig {
  const parseable = zodTextFormat(request.responseSchema, request.schemaName);
  return { type: "json_schema", name: parseable.name, schema: parseable.schema, strict: parseable.strict };
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

function toProviderError(error: unknown): ModelProviderError {
  if (error instanceof ModelProviderError) return error;
  if (error instanceof OpenAI.APIConnectionTimeoutError) return new ModelProviderError("OpenAI request timed out.", "timeout");
  if (error instanceof OpenAI.APIUserAbortError) return new ModelProviderError("OpenAI request was aborted.", "aborted");
  return new ModelProviderError();
}

class OpenAIProviderSession<T> implements ModelProviderSession<T> {
  private readonly input: ResponseInputItem[] = [];
  private readonly tools: FunctionTool[];
  private readonly format: ResponseFormatTextJSONSchemaConfig;

  constructor(
    private readonly client: OpenAI,
    private readonly model: string,
    private readonly request: ModelSessionRequest<T>
  ) {
    this.input.push({
      role: "user",
      content: request.userMessage,
    });
    this.tools = request.tools.map(toolDefinition);
    this.format = textFormat(request as ModelSessionRequest<unknown>);
  }

  next(options?: ModelCallOptions): Promise<ModelTurn> {
    return this.requestModel(options);
  }

  async submitToolResults(
    results: readonly ModelToolResult[],
    options?: ModelCallOptions
  ): Promise<ModelTurn> {
    for (const result of results) {
      this.input.push({
        type: "function_call_output",
        call_id: result.callId,
        output: JSON.stringify(result.output),
      });
    }

    return this.requestModel(options);
  }

  private async requestModel(options?: ModelCallOptions): Promise<ModelTurn> {
    try {
      const response = await this.client.responses.create(
        {
          model: this.model,
          instructions: this.request.systemPrompt,
          input: this.input,
          tools: this.tools,
          text: { format: this.format },
          store: false,
        },
        { signal: options?.signal }
      );

      this.input.push(...(response.output as ResponseInputItem[]));

      const toolCalls: ModelToolCall[] = response.output.flatMap((item) => {
        if (item.type !== "function_call") return [];
        const parsed = parseJson(item.arguments);
        return [{ id: item.call_id, name: item.name, arguments: parsed.ok ? parsed.value : undefined, malformed: !parsed.ok }];
      });

      const metadata = {
        model: response.model,
        providerRequestId: response.id,
        usage: response.usage
          ? {
              inputTokens: response.usage.input_tokens,
              outputTokens: response.usage.output_tokens,
              totalTokens: response.usage.total_tokens,
            }
          : undefined,
      };

      if (toolCalls.length > 0) {
        return { type: "tool_calls", toolCalls, ...metadata };
      }

      const refusal = response.output.some(
        (item) => item.type === "message" && item.content.some((content) => content.type === "refusal")
      );
      const parsed = response.output_text ? parseJson(response.output_text) : { ok: false as const };

      return {
        type: "final",
        output: parsed.ok ? parsed.value : undefined,
        refusal,
        ...metadata,
      };
    } catch (error) {
      throw toProviderError(error);
    }
  }
}
