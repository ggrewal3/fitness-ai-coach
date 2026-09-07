import { Router } from "express";
import { validateBody } from "../../middleware/validate.middleware.js";
import { register, login } from "./auth.controller.js";
import { loginSchema, registerSchema } from "./auth.schemas.js";

const router = Router();

router.post("/register", validateBody(registerSchema), register);
router.post("/login", validateBody(loginSchema), login);

export default router;
