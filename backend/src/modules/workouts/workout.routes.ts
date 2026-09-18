import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware.js";
import { validateBody } from "../../middleware/validate.middleware.js";
import {
  createWorkout,
  deleteWorkout,
  getWorkouts,
  updateWorkout,
} from "./workout.controller.js";
import {
  createWorkoutSessionSchema,
  updateWorkoutSessionSchema,
} from "./workout.schemas.js";

const router = Router();

router.post(
  "/",
  authMiddleware,
  validateBody(createWorkoutSessionSchema),
  createWorkout
);

router.get("/", authMiddleware, getWorkouts);

router.patch(
  "/:id",
  authMiddleware,
  validateBody(updateWorkoutSessionSchema),
  updateWorkout
);

router.delete("/:id", authMiddleware, deleteWorkout);

export default router;
