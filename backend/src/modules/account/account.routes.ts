import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware.js";
import { validateBody } from "../../middleware/validate.middleware.js";
import {
  getMyAccount,
  updateMyAccountProfile,
  updateMyPreferences,
} from "./account.controller.js";
import {
  updateAccountProfileSchema,
  updatePreferencesSchema,
} from "./account.schemas.js";

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

export default router;
