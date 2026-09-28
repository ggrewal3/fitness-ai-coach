import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware.js";
import { validateBody } from "../../middleware/validate.middleware.js";
import {
  createWorkout,
  deleteWorkout,
  getWorkout,
  getWorkouts,
  getWorkoutsForDate,
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

// Declared before "/:id" so "date" is never treated as a workout ID.
router.get("/date/:date", authMiddleware, getWorkoutsForDate);

router.get("/:id", authMiddleware, getWorkout);

router.patch(
  "/:id",
  authMiddleware,
  validateBody(updateWorkoutSessionSchema),
  updateWorkout
);

router.delete("/:id", authMiddleware, deleteWorkout);

export default router;
