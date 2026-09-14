import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware.js";
import { validateBody } from "../../middleware/validate.middleware.js";
import {
  createNutrition,
  deleteNutrition,
  getNutrition,
  updateNutrition,
} from "./nutrition.controller.js";
import {
  createNutritionEntrySchema,
  updateNutritionEntrySchema,
} from "./nutrition.schemas.js";

const router = Router();

router.post(
  "/",
  authMiddleware,
  validateBody(createNutritionEntrySchema),
  createNutrition
);

router.get("/", authMiddleware, getNutrition);

router.patch(
  "/:id",
  authMiddleware,
  validateBody(updateNutritionEntrySchema),
  updateNutrition
);

router.delete("/:id", authMiddleware, deleteNutrition);

export default router;
