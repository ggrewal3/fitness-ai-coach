import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware.js";
import { validateBody } from "../../middleware/validate.middleware.js";
import {
  getMyAccount,
  removeMyAvatar,
  updateMyAccountProfile,
  updateMyPreferences,
  uploadMyAvatar,
} from "./account.controller.js";
import {
  updateAccountProfileSchema,
  updatePreferencesSchema,
} from "./account.schemas.js";
import { parseAvatarBody, requireAvatarContentType } from "./avatarUpload.middleware.js";

const router = Router();

router.get("/", authMiddleware, getMyAccount);

router.patch(
  "/profile",
  authMiddleware,
  validateBody(updateAccountProfileSchema),
  updateMyAccountProfile
);

router.patch(
  "/preferences",
  authMiddleware,
  validateBody(updatePreferencesSchema),
  updateMyPreferences
);

// Profile photo (ADR-024). The body is the raw image (JPEG, PNG or WebP,
// max 5 MB). Authentication runs first, so unauthenticated uploads are
// rejected before the body is read.
router.put("/avatar", authMiddleware, requireAvatarContentType, parseAvatarBody, uploadMyAvatar);

router.delete("/avatar", authMiddleware, removeMyAvatar);

export default router;
