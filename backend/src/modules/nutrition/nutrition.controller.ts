import type { Response } from "express";
import type { AuthenticatedRequest } from "../../types/auth.types.js";
import { nutritionSummaryDateParamSchema } from "./nutrition.schemas.js";
import {
  createNutritionFoodItem,
  deleteNutritionFoodItem,
  getDailyNutritionSummary,
  getNutritionFoodItems,
  updateNutritionFoodItem,
} from "./nutrition.service.js";
import type {
  CreateNutritionFoodItemInput,
  UpdateNutritionFoodItemInput,
} from "./nutrition.types.js";

function parseFoodItemId(value: string | string[]): number | null {
  if (typeof value !== "string") {
    return null;
  }

  const itemId = Number(value);

  return Number.isInteger(itemId) && itemId > 0 ? itemId : null;
}

export async function createFoodItem(
  req: AuthenticatedRequest,
  res: Response
) {
  try {
    if (!req.userId) {
      return res.status(401).json({
        message: "Authentication required.",
      });
    }

    const item = await createNutritionFoodItem(
      req.userId,
      req.body as CreateNutritionFoodItemInput
    );

    return res.status(201).json(item);
  } catch (error) {
    console.error({ event: "nutrition.create.failed" });

    return res.status(500).json({
      message: "Internal Server Error",
    });
  }
}

export async function getFoodItems(
  req: AuthenticatedRequest,
  res: Response
) {
  try {
    if (!req.userId) {
      return res.status(401).json({
        message: "Authentication required.",
      });
    }

    const items = await getNutritionFoodItems(req.userId);

    return res.status(200).json(items);
  } catch (error) {
    console.error({ event: "nutrition.get.failed" });

    return res.status(500).json({
      message: "Internal Server Error",
    });
  }
}

export async function getSummary(
  req: AuthenticatedRequest,
  res: Response
) {
  try {
    if (!req.userId) {
      return res.status(401).json({
        message: "Authentication required.",
      });
    }

    const parsedDate = nutritionSummaryDateParamSchema.safeParse(
      req.params.date
    );

    if (!parsedDate.success) {
      return res.status(400).json({
        message: "Invalid date. Use YYYY-MM-DD.",
      });
    }

    const summary = await getDailyNutritionSummary(
      req.userId,
      parsedDate.data
    );

    return res.status(200).json(summary);
  } catch (error) {
    console.error({ event: "nutrition.summary.failed" });

    return res.status(500).json({
      message: "Internal Server Error",
    });
  }
}

export async function updateFoodItem(
  req: AuthenticatedRequest,
  res: Response
) {
  try {
    if (!req.userId) {
      return res.status(401).json({
        message: "Authentication required.",
      });
    }

    const itemId = parseFoodItemId(req.params.id);

    if (!itemId) {
      return res.status(400).json({
        message: "Invalid nutrition food item ID.",
      });
    }

    const item = await updateNutritionFoodItem(
      req.userId,
      itemId,
      req.body as UpdateNutritionFoodItemInput
    );

    if (!item) {
      return res.status(404).json({
        message: "Nutrition food item not found.",
      });
    }

    return res.status(200).json(item);
  } catch (error) {
    console.error({ event: "nutrition.update.failed" });

    return res.status(500).json({
      message: "Internal Server Error",
    });
  }
}

export async function deleteFoodItem(
  req: AuthenticatedRequest,
  res: Response
) {
  try {
    if (!req.userId) {
      return res.status(401).json({
        message: "Authentication required.",
      });
    }

    const itemId = parseFoodItemId(req.params.id);

    if (!itemId) {
      return res.status(400).json({
        message: "Invalid nutrition food item ID.",
      });
    }

    const deleted = await deleteNutritionFoodItem(req.userId, itemId);

    if (!deleted) {
      return res.status(404).json({
        message: "Nutrition food item not found.",
      });
    }

    return res.status(204).send();
  } catch (error) {
    console.error({ event: "nutrition.delete.failed" });

    return res.status(500).json({
      message: "Internal Server Error",
    });
  }
}
