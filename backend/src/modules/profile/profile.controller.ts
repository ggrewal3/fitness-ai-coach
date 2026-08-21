import { Response } from "express";
import { AuthenticatedRequest } from "../../types/auth.types.js";
import {
  getMyProfile,
  createMyFitnessProfile,
  updateMyFitnessProfile,
} from "./profile.service.js";

export async function getProfile(
  req: AuthenticatedRequest,
  res: Response
) {
  try {
    if (!req.userId) {
      return res.status(401).json({
        message: "Authentication required.",
      });
    }

    const user = await getMyProfile(req.userId);

    if (!user) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    return res.status(200).json(user);
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Internal Server Error",
    });
  }
}

export async function createProfile(
  req: AuthenticatedRequest,
  res: Response
) {
  try {
    if (!req.userId) {
      return res.status(401).json({
        message: "Authentication required.",
      });
    }

    const result = await createMyFitnessProfile(
      req.userId,
      req.body
    );

    if (!result.success) {
      return res.status(409).json({
        message: result.message,
      });
    }

    return res.status(201).json(result.profile);
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Internal Server Error",
    });
  }
}

export async function updateProfile(
  req: AuthenticatedRequest,
  res: Response
) {
  try {
    if (!req.userId) {
      return res.status(401).json({
        message: "Authentication required.",
      });
    }

    const result = await updateMyFitnessProfile(
      req.userId,
      req.body
    );

    if (!result.success) {
      return res.status(404).json({
        message: result.message,
      });
    }

    return res.status(200).json(result.profile);
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Internal Server Error",
    });
  }
}