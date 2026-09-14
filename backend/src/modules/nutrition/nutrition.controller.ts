import type { Response } from "express";
import type { AuthenticatedRequest } from "../../types/auth.types.js";
import {
  createNutritionEntry,
  deleteNutritionEntry,
  getNutritionEntries,
  NutritionEntryConflictError,
  updateNutritionEntry,
} from "./nutrition.service.js";
import type {
  CreateNutritionEntryInput,
  UpdateNutritionEntryInput,
} from "./nutrition.types.js";

function parseNutritionEntryId(value: string | string[]): number | null {
  if (typeof value !== "string") {
    return null;
  }

  const entryId = Number(value);

  return Number.isInteger(entryId) && entryId > 0 ? entryId : null;
}

export async function createNutrition(
  req: AuthenticatedRequest,
  res: Response
) {
  try {
    if (!req.userId) {
      return res.status(401).json({
        message: "Authentication required.",
      });
    }

    const entry = await createNutritionEntry(
      req.userId,
      req.body as CreateNutritionEntryInput
    );

    return res.status(201).json(entry);
  } catch (error) {
    if (error instanceof NutritionEntryConflictError) {
      return res.status(409).json({
        message: error.message,
      });
    }

    console.error({ event: "nutrition.create.failed" });

    return res.status(500).json({
      message: "Internal Server Error",
    });
  }
}

export async function getNutrition(
  req: AuthenticatedRequest,
  res: Response
) {
  try {
    if (!req.userId) {
      return res.status(401).json({
        message: "Authentication required.",
      });
    }

    const entries = await getNutritionEntries(req.userId);

    return res.status(200).json(entries);
  } catch (error) {
    console.error({ event: "nutrition.get.failed" });

    return res.status(500).json({
      message: "Internal Server Error",
    });
  }
}

export async function updateNutrition(
  req: AuthenticatedRequest,
  res: Response
) {
  try {
    if (!req.userId) {
      return res.status(401).json({
        message: "Authentication required.",
      });
    }

    const entryId = parseNutritionEntryId(req.params.id);

    if (!entryId) {
      return res.status(400).json({
        message: "Invalid nutrition entry ID.",
      });
    }

    const entry = await updateNutritionEntry(
      req.userId,
      entryId,
      req.body as UpdateNutritionEntryInput
    );

    if (!entry) {
      return res.status(404).json({
        message: "Nutrition entry not found.",
      });
    }

    return res.status(200).json(entry);
  } catch (error) {
    if (error instanceof NutritionEntryConflictError) {
      return res.status(409).json({
        message: error.message,
      });
    }

    console.error({ event: "nutrition.update.failed" });

    return res.status(500).json({
      message: "Internal Server Error",
    });
  }
}

export async function deleteNutrition(
  req: AuthenticatedRequest,
  res: Response
) {
  try {
    if (!req.userId) {
      return res.status(401).json({
        message: "Authentication required.",
      });
    }

    const entryId = parseNutritionEntryId(req.params.id);

    if (!entryId) {
      return res.status(400).json({
        message: "Invalid nutrition entry ID.",
      });
    }

    const deleted = await deleteNutritionEntry(req.userId, entryId);

    if (!deleted) {
      return res.status(404).json({
        message: "Nutrition entry not found.",
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
