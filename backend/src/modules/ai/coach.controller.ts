import { Response } from "express";
import { AuthenticatedRequest } from "../../types/auth.types.js";
import {
  ModelOutputValidationError,
  ModelProviderError,
} from "./model.provider.js";
import { CoachDeadlineError, CoachTurnLimitError, generateCoachResponse } from "./coach.service.js";
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
    const { response, sources } = await generateCoachResponse(
      req.userId,
      req.body as CoachRequest
    );

    return res.status(200).json({ ...response, sources });
  } catch (error) {
    if (error instanceof CoachDeadlineError) {
      return res.status(504).json({
        message: "AI Coach took too long to respond. Please try again.",
      });
    }

    if (error instanceof CoachTurnLimitError) {
      return res.status(502).json({
        message: "AI Coach couldn't complete a response. Try asking a more specific question.",
      });
    }

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
