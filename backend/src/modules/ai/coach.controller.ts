import { Response } from "express";
import { AuthenticatedRequest } from "../../types/auth.types.js";
import {
  ModelOutputValidationError,
  ModelProviderError,
} from "./model.provider.js";
import { generateCoachResponse } from "./coach.service.js";
import type { CoachRequest } from "./coach.types.js";

export async function coach(
  req: AuthenticatedRequest,
  res: Response
) {
  if (!req.userId) {
    return res.status(401).json({
      message: "Authentication required.",
    });
  }

  try {
    const response = await generateCoachResponse(
      req.userId,
      req.body as CoachRequest
    );

    return res.status(200).json(response);
  } catch (error) {
    if (error instanceof ModelProviderError) {
      return res.status(503).json({
        message: "AI Coach is temporarily unavailable.",
      });
    }

    if (error instanceof ModelOutputValidationError) {
      return res.status(502).json({
        message: "AI Coach returned an invalid response.",
      });
    }

    return res.status(500).json({
      message: "Internal Server Error",
    });
  }
}
