import type { Response } from "express";
import {
  AVATAR_INPUT_TYPES,
  InvalidImageError,
  type AvatarInputType,
} from "../../lib/images/avatarImage.js";
import type { AuthenticatedRequest } from "../../types/auth.types.js";
import {
  getAccount,
  updateAccountProfile,
  updatePreferences,
} from "./account.service.js";
import { AvatarStorageError, removeAvatar, replaceAvatar } from "./avatar.service.js";
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

export async function uploadMyAvatar(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.userId) {
      return res.status(401).json({ message: "Authentication required." });
    }

    // requireAvatarContentType has already guaranteed one of these types.
    const declaredType = req.is([...AVATAR_INPUT_TYPES]) as AvatarInputType;
    const upload = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);

    const account = await replaceAvatar(req.userId, upload, declaredType);

    if (!account) {
      return res.status(404).json({ message: "User not found." });
    }

    return res.status(200).json(account);
  } catch (error) {
    if (error instanceof InvalidImageError) {
      return res.status(400).json({ message: error.message });
    }

    if (error instanceof AvatarStorageError) {
      return res.status(503).json({ message: "Profile photos are temporarily unavailable. Try again later." });
    }

    console.error({ event: "avatar.upload.failed" });

    return res.status(500).json({ message: "Internal Server Error" });
  }
}

export async function removeMyAvatar(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.userId) {
      return res.status(401).json({ message: "Authentication required." });
    }

    const account = await removeAvatar(req.userId);

    if (!account) {
      return res.status(404).json({ message: "User not found." });
    }

    return res.status(200).json(account);
  } catch {
    console.error({ event: "avatar.remove.failed" });

    return res.status(500).json({ message: "Internal Server Error" });
  }
}
