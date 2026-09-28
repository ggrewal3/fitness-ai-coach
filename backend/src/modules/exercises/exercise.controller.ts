import type { Response } from "express";
import type { AuthenticatedRequest } from "../../types/auth.types.js";
import { exerciseSearchQuerySchema } from "./exercise.schemas.js";
import {
  CustomExerciseLimitError,
  MAX_CUSTOM_EXERCISES_PER_USER,
  findOrCreateCustomExercise,
  searchExercises,
} from "./exercise.service.js";
import type { CreateExerciseInput } from "./exercise.types.js";

export async function getExercises(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.userId) {
      return res.status(401).json({
        message: "Authentication required.",
      });
    }

    // Express 5 exposes req.query as a read-only getter, so the query is
    // validated here rather than through validateBody.
    const query = exerciseSearchQuerySchema.safeParse(req.query);

    if (!query.success) {
      return res.status(400).json({
        message: "Validation failed.",
        errors: query.error.issues.map((issue) => ({
          field: issue.path.join(".") || "query",
          message: issue.message,
        })),
      });
    }

    const exercises = await searchExercises(
      req.userId,
      query.data.search,
      query.data.limit
    );

    return res.status(200).json(exercises);
  } catch (error) {
    console.error({ event: "exercise.search.failed" });

    return res.status(500).json({
      message: "Internal Server Error",
    });
  }
}

export async function createExercise(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.userId) {
      return res.status(401).json({
        message: "Authentication required.",
      });
    }

    const { name } = req.body as CreateExerciseInput;
    const result = await findOrCreateCustomExercise(req.userId, name);

    return res.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    if (error instanceof CustomExerciseLimitError) {
      return res.status(400).json({
        message: "Custom exercise limit reached.",
        errors: [
          {
            field: "name",
            message: `You can create up to ${MAX_CUSTOM_EXERCISES_PER_USER} custom exercises.`,
          },
        ],
      });
    }

    console.error({ event: "exercise.create.failed" });

    return res.status(500).json({
      message: "Internal Server Error",
    });
  }
}
