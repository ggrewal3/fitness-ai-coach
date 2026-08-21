import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware.js";
import {
  getProfile,
  createProfile,
  updateProfile,
} from "./profile.controller.js";

const router = Router();

router.get("/me", authMiddleware, getProfile);

router.post("/", authMiddleware, createProfile);

router.patch("/me", authMiddleware, updateProfile);

export default router;