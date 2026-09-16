import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware.js";
import { validateBody } from "../../middleware/validate.middleware.js";
import {
  createActivity,
  deleteActivity,
  getActivity,
  updateActivity,
} from "./activity.controller.js";
import {
  createDailyActivitySchema,
  updateDailyActivitySchema,
} from "./activity.schemas.js";

const router = Router();

router.post(
  "/",
  authMiddleware,
  validateBody(createDailyActivitySchema),
  createActivity
);

router.get("/", authMiddleware, getActivity);

router.patch(
  "/:id",
  authMiddleware,
  validateBody(updateDailyActivitySchema),
  updateActivity
);

router.delete("/:id", authMiddleware, deleteActivity);

export default router;
