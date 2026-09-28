import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware.js";
import { validateBody } from "../../middleware/validate.middleware.js";
import { createExercise, getExercises } from "./exercise.controller.js";
import { createExerciseSchema } from "./exercise.schemas.js";

const router = Router();

// Built-in exercises are managed only by the seed script: there are
// deliberately no update/delete routes, and creation always produces (or
// reuses) an exercise owned by the authenticated user.
router.get("/", authMiddleware, getExercises);

router.post(
  "/",
  authMiddleware,
  validateBody(createExerciseSchema),
  createExercise
);

export default router;
