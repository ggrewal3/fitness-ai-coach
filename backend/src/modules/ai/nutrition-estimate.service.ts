import {
  NUTRITION_ESTIMATE_PROMPT_VERSION,
  NUTRITION_ESTIMATE_SYSTEM_PROMPT,
} from "./nutrition-estimate.prompts.js";
import {
  nutritionEstimateModelOutputSchema,
  nutritionEstimateResultSchema,
} from "./nutrition-estimate.schemas.js";
import {
  ModelOutputValidationError,
  ModelProviderError,
  type ModelProvider,
} from "./model.provider.js";
import { OpenAIProvider } from "./openai.provider.js";
import type {
  NutritionEstimateRequest,
  NutritionEstimateResult,
} from "./nutrition-estimate.types.js";

let modelProvider: ModelProvider | undefined;

function getModelProvider() {
  if (!modelProvider) {
    modelProvider = new OpenAIProvider();
  }

  return modelProvider;
}

// Read/compute only - this never touches Prisma. Callers must not persist the
// returned estimate directly; the frontend confirms it and resubmits through
// the normal authenticated food-item POST endpoint, which re-validates the
// final values regardless of where they came from.
export async function estimateNutrition(
  userId: number,
  request: NutritionEstimateRequest
): Promise<NutritionEstimateResult> {
  const startedAt = Date.now();
  let model = "unknown";

  const userMessage = [
    `Food: ${request.foodName}`,
    `Quantity: ${request.quantity} ${request.unit}`,
    "Estimate the calories and macronutrients for this exact food and quantity.",
  ].join("\n");

  try {
    const provider = getModelProvider();
    const session = provider.createSession({
      systemPrompt: NUTRITION_ESTIMATE_SYSTEM_PROMPT,
      userMessage,
      schemaName: "nutrition_estimate",
      responseSchema: nutritionEstimateModelOutputSchema,
      tools: [],
    });

    const turn = await session.next();
    model = turn.model;

    if (turn.type !== "final") {
      throw new ModelProviderError(
        "Nutrition estimation did not return a final response."
      );
    }

    const parsedModelOutput = nutritionEstimateModelOutputSchema.safeParse(
      turn.output
    );

    if (!parsedModelOutput.success) {
      throw new ModelOutputValidationError();
    }

    const parsedResult = nutritionEstimateResultSchema.safeParse({
      foodName: request.foodName,
      quantity: request.quantity,
      unit: request.unit,
      ...parsedModelOutput.data,
    });

    if (!parsedResult.success) {
      throw new ModelOutputValidationError();
    }

    console.info({
      event: "ai.nutritionEstimate.completed",
      userId,
      model,
      promptVersion: NUTRITION_ESTIMATE_PROMPT_VERSION,
      latencyMs: Date.now() - startedAt,
      usage: turn.usage,
      success: true,
    });

    return parsedResult.data;
  } catch (error) {
    console.error({
      event: "ai.nutritionEstimate.completed",
      userId,
      model,
      promptVersion: NUTRITION_ESTIMATE_PROMPT_VERSION,
      latencyMs: Date.now() - startedAt,
      success: false,
    });

    throw error;
  }
}
