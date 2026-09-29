import type { Response } from "express";
import type { AuthenticatedRequest } from "../../types/auth.types.js";
import {
  getAccount,
  updateAccountProfile,
  updatePreferences,
} from "./account.service.js";
import type {
  UpdateAccountProfileInput,
  UpdatePreferencesInput,
} from "./account.types.js";

// The user is always identified by the token; bodies never carry a userId
// (the strict schemas reject one).

export async function getMyAccount(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.userId) {
      return res.status(401).json({ message: "Authentication required." });
    }

    const account = await getAccount(req.userId);

    if (!account) {
      return res.status(404).json({ message: "User not found." });
    }

    return res.status(200).json(account);
  } catch (error) {
    console.error(error);

    return res.status(500).json({ message: "Internal Server Error" });
  }
}

export async function updateMyAccountProfile(
  req: AuthenticatedRequest,
  res: Response
) {
  try {
    if (!req.userId) {
      return res.status(401).json({ message: "Authentication required." });
    }

    const account = await updateAccountProfile(
      req.userId,
      req.body as UpdateAccountProfileInput
    );

    if (!account) {
      return res.status(404).json({ message: "User not found." });
    }

    return res.status(200).json(account);
  } catch (error) {
    console.error(error);

    return res.status(500).json({ message: "Internal Server Error" });
  }
}

export async function updateMyPreferences(
  req: AuthenticatedRequest,
  res: Response
) {
  try {
    if (!req.userId) {
      return res.status(401).json({ message: "Authentication required." });
    }

    const preferences = await updatePreferences(
      req.userId,
      req.body as UpdatePreferencesInput
    );

    if (!preferences) {
      return res.status(404).json({ message: "User not found." });
    }

    return res.status(200).json(preferences);
  } catch (error) {
    console.error(error);

    return res.status(500).json({ message: "Internal Server Error" });
  }
}
