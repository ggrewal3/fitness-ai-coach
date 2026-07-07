import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5001;

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.status(200).json({
    status: "success",
    message: "Fitness AI backend running",
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});