import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import authRoutes from "./modules/auth/auth.routes.js";
import accountRoutes from "./modules/account/account.routes.js";
import { authMiddleware } from "./middleware/auth.middleware.js";
import profileRoutes from "./modules/profile/profile.routes.js";
import checkinRoutes from "./modules/checkins/checkin.routes.js";
import aiRoutes from "./modules/ai/ai.routes.js";
import nutritionRoutes from "./modules/nutrition/nutrition.routes.js";
import activityRoutes from "./modules/activity/activity.routes.js";
import workoutRoutes from "./modules/workouts/workout.routes.js";
import exerciseRoutes from "./modules/exercises/exercise.routes.js";
import mediaRoutes from "./modules/media/media.routes.js";

dotenv.config();

// The Express app is built here without listening, so automated tests can
// start it on an ephemeral port. server.ts owns the real listener.
const app = express();

// Retry-After (sent with 429) must be exposed for a cross-origin frontend
// to read it; the AI Coach uses it for its retry countdown.
app.use(cors({ exposedHeaders: ["Retry-After"] }));
app.use(express.json());
app.use("/api/auth", authRoutes);
app.use("/api/account", accountRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/checkins", checkinRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/nutrition", nutritionRoutes);
app.use("/api/activity", activityRoutes);
app.use("/api/workouts", workoutRoutes);
app.use("/api/exercises", exerciseRoutes);
app.use("/api/media", mediaRoutes);

app.get("/api/health", (_req, res) => {
  res.status(200).json({
    status: "success",
    message: "Fitness AI backend running",
  });
});

app.get("/api/protected-test", authMiddleware, (_req, res) => {
  res.status(200).json({
    message: "You accessed a protected route.",
  });
});

// A request body that isn't valid JSON gets a plain 400. Without this,
// Express's default error handler logs the parser error, whose message quotes
// a fragment of the body (it could be part of a password or sign-in credential).
app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if ((error as { type?: unknown } | null)?.type === "entity.parse.failed") {
    return res.status(400).json({ message: "Request body must be valid JSON." });
  }
  next(error);
});

export default app;
