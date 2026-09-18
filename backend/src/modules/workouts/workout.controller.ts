import type { Response } from "express";
import type { AuthenticatedRequest } from "../../types/auth.types.js";
import {
  createWorkoutSession,
  deleteWorkoutSession,
  getWorkoutSessions,
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

    const workouts = await getWorkoutSessions(req.userId);

    return res.status(200).json(workouts);
  } catch (error) {
    console.error({ event: "workout.get.failed" });

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
