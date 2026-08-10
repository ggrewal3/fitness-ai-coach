import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createUser } from "./modules/users/user.service.js";
import authRoutes from "./modules/auth/auth.routes.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5001;

app.use(cors());
app.use(express.json());
app.use("/api/auth", authRoutes);

app.get("/api/health", (_req, res) => {
  res.status(200).json({
    status: "success",
    message: "Fitness AI backend running",
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});