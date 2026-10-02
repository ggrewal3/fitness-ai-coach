import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware.js";
import { createUserRateLimiter } from "../../middleware/userRateLimit.middleware.js";
import { validateBody } from "../../middleware/validate.middleware.js";
import { coach } from "./coach.controller.js";
import { coachRequestSchema } from "./coach.schemas.js";
import { nutritionEstimate } from "./nutrition-estimate.controller.js";
import { nutritionEstimateRequestSchema } from "./nutrition-estimate.schemas.js";

const router = Router();

/**
 * Per-user coach limits (in-memory, single instance): 10 per minute stops
 * runaway loops and rapid resubmits while allowing normal conversation; 150
 * per day bounds model cost. Only the coach route is limited.
 */
export const coachRateLimiter = createUserRateLimiter({
  windows: [
    { windowMs: 60 * 1000, max: 10 },
    { windowMs: 24 * 60 * 60 * 1000, max: 150 },
  ],
  message: "You've sent a lot of messages to AI Coach. Please wait a moment and try again.",
});

router.post(
  "/coach",
  authMiddleware,
  coachRateLimiter.middleware,
  validateBody(coachRequestSchema),
  coach
);

router.post(
  "/nutrition/estimate",
  authMiddleware,
  validateBody(nutritionEstimateRequestSchema),
  nutritionEstimate
);

export default router;
