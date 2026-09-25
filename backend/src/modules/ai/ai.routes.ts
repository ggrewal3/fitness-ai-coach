import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware.js";
import { validateBody } from "../../middleware/validate.middleware.js";
import { coach } from "./coach.controller.js";
import { coachRequestSchema } from "./coach.schemas.js";
import { nutritionEstimate } from "./nutrition-estimate.controller.js";
import { nutritionEstimateRequestSchema } from "./nutrition-estimate.schemas.js";

const router = Router();

router.post(
  "/coach",
  authMiddleware,
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
