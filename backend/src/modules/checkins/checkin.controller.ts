import { Response } from "express";
import { AuthenticatedRequest } from "../../types/auth.types.js";
import {
  createWeightCheckIn,
  deleteMyWeightCheckIn,
  getMyWeightCheckIns,
} from "./checkin.service.js";
import { CreateCheckInInput } from "./checkin.types.js";

export async function createCheckIn(
  req: AuthenticatedRequest,
  res: Response
) {
  try {
    if (!req.userId) {
      return res.status(401).json({
        message: "Authentication required.",
      });
    }

    const checkIn = await createWeightCheckIn(
      req.userId,
      req.body as CreateCheckInInput
    );

    return res.status(201).json(checkIn);
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Internal Server Error",
    });
  }
}

export async function getCheckIns(
  req: AuthenticatedRequest,
  res: Response
) {
  try {
    if (!req.userId) {
      return res.status(401).json({
        message: "Authentication required.",
      });
    }

    const checkIns = await getMyWeightCheckIns(req.userId);

    return res.status(200).json(checkIns);
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Internal Server Error",
    });
  }
}

export async function deleteCheckIn(
  req: AuthenticatedRequest,
  res: Response
) {
  try {
    if (!req.userId) {
      return res.status(401).json({
        message: "Authentication required.",
      });
    }

    const checkInId = Number(req.params.id);

    if (!Number.isInteger(checkInId) || checkInId <= 0) {
      return res.status(400).json({
        message: "Invalid check-in ID.",
      });
    }

    const deleted = await deleteMyWeightCheckIn(req.userId, checkInId);

    if (!deleted) {
      return res.status(404).json({
        message: "Check-in not found.",
      });
    }

    return res.status(204).send();
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Internal Server Error",
    });
  }
}
