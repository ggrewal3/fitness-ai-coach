import type { Response } from "express";
import type { AuthenticatedRequest } from "../../types/auth.types.js";
import { workoutDateSchema, workoutListQuerySchema } from "./workout.schemas.js";
import {
  InvalidExerciseReferenceError,
  createWorkoutSession,
  deleteWorkoutSession,
  getWorkoutSession,
  getWorkoutSessionsForDate,
  listWorkoutSessions,
  updateWorkoutSession,
} from "./workout.service.js";
import type {
  CreateWorkoutSessionInput,
  UpdateWorkoutSessionInput,
} from "./workout.types.js";

function parseWorkoutSessionId(value: string | string[]): number | null {
  if (typeof value !== "string") {
    return null;
  }

  const workoutSessionId = Number(value);

  return Number.isInteger(workoutSessionId) && workoutSessionId > 0
    ? workoutSessionId
    : null;
}

function invalidExerciseResponse(
  res: Response,
  error: InvalidExerciseReferenceError
) {
  return res.status(400).json({
    message: "Validation failed.",
    errors: error.fields.map((field) => ({
      field,
      message: "Exercise not found.",
    })),
  });
}

export async function createWorkout(
  req: AuthenticatedRequest,
  res: Response
) {
  try {
    if (!req.userId) {
      return res.status(401).json({
        message: "Authentication required.",
      });
    }

    const workout = await createWorkoutSession(
      req.userId,
      req.body as CreateWorkoutSessionInput
    );

    return res.status(201).json(workout);
  } catch (error) {
    if (error instanceof InvalidExerciseReferenceError) {
      return invalidExerciseResponse(res, error);
    }

    console.error({ event: "workout.create.failed" });

    return res.status(500).json({
      message: "Internal Server Error",
    });
  }
}

export async function getWorkouts(
  req: AuthenticatedRequest,
  res: Response
) {
  try {
    if (!req.userId) {
      return res.status(401).json({
        message: "Authentication required.",
      });
    }

    // Express 5 exposes req.query as a read-only getter, so it is validated
    // here rather than through validateBody.
    const query = workoutListQuerySchema.safeParse(req.query);

    if (!query.success) {
      return res.status(400).json({
        message: "Validation failed.",
        errors: query.error.issues.map((issue) => ({
          field: issue.path.join(".") || "query",
          message: issue.message,
        })),
      });
    }

    const workouts = await listWorkoutSessions(req.userId, query.data);

    return res.status(200).json(workouts);
  } catch (error) {
    console.error({ event: "workout.get.failed" });

    return res.status(500).json({
      message: "Internal Server Error",
    });
  }
}

export async function getWorkout(
  req: AuthenticatedRequest,
  res: Response
) {
  try {
    if (!req.userId) {
      return res.status(401).json({
        message: "Authentication required.",
      });
    }

    const workoutSessionId = parseWorkoutSessionId(req.params.id);

    if (!workoutSessionId) {
      return res.status(400).json({
        message: "Invalid workout session ID.",
      });
    }

    const workout = await getWorkoutSession(req.userId, workoutSessionId);

    if (!workout) {
      return res.status(404).json({
        message: "Workout session not found.",
      });
    }

    return res.status(200).json(workout);
  } catch (error) {
    console.error({ event: "workout.get_one.failed" });

    return res.status(500).json({
      message: "Internal Server Error",
    });
  }
}

export async function getWorkoutsForDate(
  req: AuthenticatedRequest,
  res: Response
) {
  try {
    if (!req.userId) {
      return res.status(401).json({
        message: "Authentication required.",
      });
    }

    const workoutDate = workoutDateSchema.safeParse(req.params.date);

    if (!workoutDate.success) {
      return res.status(400).json({
        message: "Validation failed.",
        errors: [
          {
            field: "date",
            message: "Date must be a valid YYYY-MM-DD calendar date.",
          },
        ],
      });
    }

    const workouts = await getWorkoutSessionsForDate(
      req.userId,
      workoutDate.data
    );

    return res.status(200).json(workouts);
  } catch (error) {
    console.error({ event: "workout.get_by_date.failed" });

    return res.status(500).json({
      message: "Internal Server Error",
    });
  }
}

export async function updateWorkout(
  req: AuthenticatedRequest,
  res: Response
) {
  try {
    if (!req.userId) {
      return res.status(401).json({
        message: "Authentication required.",
      });
    }

    const workoutSessionId = parseWorkoutSessionId(req.params.id);

    if (!workoutSessionId) {
      return res.status(400).json({
        message: "Invalid workout session ID.",
      });
    }

    const workout = await updateWorkoutSession(
      req.userId,
      workoutSessionId,
      req.body as UpdateWorkoutSessionInput
    );

    if (!workout) {
      return res.status(404).json({
        message: "Workout session not found.",
      });
    }

    return res.status(200).json(workout);
  } catch (error) {
    if (error instanceof InvalidExerciseReferenceError) {
      return invalidExerciseResponse(res, error);
    }

    console.error({ event: "workout.update.failed" });

    return res.status(500).json({
      message: "Internal Server Error",
    });
  }
}

export async function deleteWorkout(
  req: AuthenticatedRequest,
  res: Response
) {
  try {
    if (!req.userId) {
      return res.status(401).json({
        message: "Authentication required.",
      });
    }

    const workoutSessionId = parseWorkoutSessionId(req.params.id);

    if (!workoutSessionId) {
      return res.status(400).json({
        message: "Invalid workout session ID.",
      });
    }

    const deleted = await deleteWorkoutSession(req.userId, workoutSessionId);

    if (!deleted) {
      return res.status(404).json({
        message: "Workout session not found.",
      });
    }

    return res.status(204).send();
  } catch (error) {
    console.error({ event: "workout.delete.failed" });

    return res.status(500).json({
      message: "Internal Server Error",
    });
  }
}
