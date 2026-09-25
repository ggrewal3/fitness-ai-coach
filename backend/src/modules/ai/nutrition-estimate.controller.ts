import { Response } from "express";
import { AuthenticatedRequest } from "../../types/auth.types.js";
import {
  ModelOutputValidationError,
  ModelProviderError,
} from "./model.provider.js";
import { estimateNutrition } from "./nutrition-estimate.service.js";
import type { NutritionEstimateRequest } from "./nutrition-estimate.types.js";

export async function nutritionEstimate(
  req: AuthenticatedRequest,
  res: Response
) {
  if (!req.userId) {
    return res.status(401).json({
      message: "Authentication required.",
    });
  }

  try {
    const estimate = await estimateNutrition(
      req.userId,
      req.body as NutritionEstimateRequest
    );

    return res.status(200).json(estimate);
  } catch (error) {
    if (error instanceof ModelProviderError) {
      return res.status(503).json({
        message: "Nutrition estimation is temporarily unavailable.",
      });
    }

    if (error instanceof ModelOutputValidationError) {
      return res.status(502).json({
        message: "Nutrition estimation returned an invalid response.",
      });
    }

    return res.status(500).json({
      message: "Internal Server Error",
    });
  }
}
