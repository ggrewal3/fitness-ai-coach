import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createUser } from "./modules/users/user.service.js";
import authRoutes from "./modules/auth/auth.routes.js";
import { authMiddleware } from "./middleware/auth.middleware.js";
import profileRoutes from "./modules/profile/profile.routes.js";
import checkinRoutes from "./modules/checkins/checkin.routes.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5001;

app.use(cors());
app.use(express.json());
app.use("/api/auth", authRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/checkins", checkinRoutes);

app.get("/api/health", (_req, res) => {
  res.status(200).json({
    status: "success",
    message: "Fitness AI backend running",
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

app.get("/api/protected-test", authMiddleware, (_req, res) => {
  res.status(200).json({
    message: "You accessed a protected route.",
  });
});
