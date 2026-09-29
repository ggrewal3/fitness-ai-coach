import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware.js";
import { validateBody } from "../../middleware/validate.middleware.js";
import {
  getProfile,
  createProfile,
  updateProfile,
} from "./profile.controller.js";
import {
  createFitnessProfileSchema,
  updateFitnessProfileSchema,
} from "./profile.schemas.js";

const router = Router();

router.get("/me", authMiddleware, getProfile);

router.post(
  "/",
  authMiddleware,
  validateBody(createFitnessProfileSchema),
  createProfile
);

router.patch(
  "/me",
  authMiddleware,
  validateBody(updateFitnessProfileSchema),
  updateProfile
);

export default router;