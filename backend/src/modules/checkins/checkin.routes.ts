import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware.js";
import { validateBody } from "../../middleware/validate.middleware.js";
import {
  createCheckIn,
  deleteCheckIn,
  getCheckIns,
} from "./checkin.controller.js";
import { createCheckInSchema } from "./checkin.schemas.js";

const router = Router();

router.post(
  "/",
  authMiddleware,
  validateBody(createCheckInSchema),
  createCheckIn
);

router.get("/", authMiddleware, getCheckIns);

router.delete("/:id", authMiddleware, deleteCheckIn);

export default router;
