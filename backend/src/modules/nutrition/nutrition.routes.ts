import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware.js";
import { validateBody } from "../../middleware/validate.middleware.js";
import {
  createFoodItem,
  deleteFoodItem,
  getFoodItems,
  getSummary,
  updateFoodItem,
} from "./nutrition.controller.js";
import {
  createNutritionFoodItemSchema,
  updateNutritionFoodItemSchema,
} from "./nutrition.schemas.js";

const router = Router();

router.post(
  "/",
  authMiddleware,
  validateBody(createNutritionFoodItemSchema),
  createFoodItem
);

router.get("/", authMiddleware, getFoodItems);

router.get("/summary/:date", authMiddleware, getSummary);

router.patch(
  "/:id",
  authMiddleware,
  validateBody(updateNutritionFoodItemSchema),
  updateFoodItem
);

router.delete("/:id", authMiddleware, deleteFoodItem);

export default router;
