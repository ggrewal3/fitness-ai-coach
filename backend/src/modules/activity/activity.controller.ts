import type { Response } from "express";
import type { AuthenticatedRequest } from "../../types/auth.types.js";
import {
  createDailyActivity,
  DailyActivityConflictError,
  deleteDailyActivity,
  getDailyActivities,
  updateDailyActivity,
} from "./activity.service.js";
import type {
  CreateDailyActivityInput,
  UpdateDailyActivityInput,
} from "./activity.types.js";

function parseActivityId(value: string | string[]): number | null {
  if (typeof value !== "string") {
    return null;
  }

  const activityId = Number(value);

  return Number.isInteger(activityId) && activityId > 0 ? activityId : null;
}

export async function createActivity(
  req: AuthenticatedRequest,
  res: Response
) {
  try {
    if (!req.userId) {
      return res.status(401).json({
        message: "Authentication required.",
      });
    }

    const activity = await createDailyActivity(
      req.userId,
      req.body as CreateDailyActivityInput
    );

    return res.status(201).json(activity);
  } catch (error) {
    if (error instanceof DailyActivityConflictError) {
      return res.status(409).json({
        message: error.message,
      });
    }

    console.error({ event: "activity.create.failed" });

    return res.status(500).json({
      message: "Internal Server Error",
    });
  }
}

export async function getActivity(
  req: AuthenticatedRequest,
  res: Response
) {
  try {
    if (!req.userId) {
      return res.status(401).json({
        message: "Authentication required.",
      });
    }

    const activities = await getDailyActivities(req.userId);

    return res.status(200).json(activities);
  } catch (error) {
    console.error({ event: "activity.get.failed" });

    return res.status(500).json({
      message: "Internal Server Error",
    });
  }
}

export async function updateActivity(
  req: AuthenticatedRequest,
  res: Response
) {
  try {
    if (!req.userId) {
      return res.status(401).json({
        message: "Authentication required.",
      });
    }

    const activityId = parseActivityId(req.params.id);

    if (!activityId) {
      return res.status(400).json({
        message: "Invalid activity ID.",
      });
    }

    const activity = await updateDailyActivity(
      req.userId,
      activityId,
      req.body as UpdateDailyActivityInput
    );

    if (!activity) {
      return res.status(404).json({
        message: "Activity entry not found.",
      });
    }

    return res.status(200).json(activity);
  } catch (error) {
    if (error instanceof DailyActivityConflictError) {
      return res.status(409).json({
        message: error.message,
      });
    }

    console.error({ event: "activity.update.failed" });

    return res.status(500).json({
      message: "Internal Server Error",
    });
  }
}

export async function deleteActivity(
  req: AuthenticatedRequest,
  res: Response
) {
  try {
    if (!req.userId) {
      return res.status(401).json({
        message: "Authentication required.",
      });
    }

    const activityId = parseActivityId(req.params.id);

    if (!activityId) {
      return res.status(400).json({
        message: "Invalid activity ID.",
      });
    }

    const deleted = await deleteDailyActivity(req.userId, activityId);

    if (!deleted) {
      return res.status(404).json({
        message: "Activity entry not found.",
      });
    }

    return res.status(204).send();
  } catch (error) {
    console.error({ event: "activity.delete.failed" });

    return res.status(500).json({
      message: "Internal Server Error",
    });
  }
}
