import OpenAI from "openai";
import {
  zodResponsesFunction,
  zodTextFormat,
} from "openai/helpers/zod";
import type { ResponseInputItem } from "openai/resources/responses/responses.js";
import {
  ModelProviderError,
  type ModelProvider,
  type ModelProviderSession,
  type ModelSessionRequest,
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
      throw new ModelProviderError("OpenAI provider is not configured.");
    }

    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  createSession<T>(
    request: ModelSessionRequest<T>
  ): ModelProviderSession<T> {
    return new OpenAIProviderSession(this.client, this.model, request);
  }
}

class OpenAIProviderSession<T> implements ModelProviderSession<T> {
  private readonly input: ResponseInputItem[] = [];
  private readonly tools;

  constructor(
    private readonly client: OpenAI,
    private readonly model: string,
    private readonly request: ModelSessionRequest<T>
  ) {
    this.input.push({
      role: "user",
      content: request.userMessage,
    });

    this.tools = request.tools.map((tool) =>
      zodResponsesFunction({
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      })
    );
  }

  next(): Promise<ModelTurn> {
    return this.requestModel();
  }

  async submitToolResults(
    results: readonly ModelToolResult[]
  ): Promise<ModelTurn> {
    for (const result of results) {
      this.input.push({
        type: "function_call_output",
        call_id: result.callId,
        output: JSON.stringify(result.output),
      });
    }

    return this.requestModel();
  }

  private async requestModel(): Promise<ModelTurn> {
    try {
      const response = await this.client.responses.parse({
        model: this.model,
        instructions: this.request.systemPrompt,
        input: this.input,
        tools: this.tools,
        text: {
          format: zodTextFormat(
            this.request.responseSchema,
            this.request.schemaName
          ),
        },
        store: false,
      });

      const responseItems = response.output.map((item) => {
        if (item.type !== "function_call") {
          return item;
        }

        const { parsed_arguments: _parsedArguments, ...functionCall } = item;
        return functionCall;
      });

      this.input.push(...(responseItems as ResponseInputItem[]));

      const toolCalls = response.output
        .filter((item) => item.type === "function_call")
        .map((item) => ({
          id: item.call_id,
          name: item.name,
          arguments: item.parsed_arguments,
        }));

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
        return {
          type: "tool_calls",
          toolCalls,
          ...metadata,
        };
      }

      if (!response.output_parsed) {
        throw new ModelProviderError("OpenAI returned no final output.");
      }

      return {
        type: "final",
        output: response.output_parsed,
        ...metadata,
      };
    } catch (error) {
      if (error instanceof ModelProviderError) {
        throw error;
      }

      throw new ModelProviderError();
    }
  }
}
