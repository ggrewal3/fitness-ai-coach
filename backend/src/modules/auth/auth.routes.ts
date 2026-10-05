import { Router } from "express";
import { validateBody } from "../../middleware/validate.middleware.js";
import { appleSignIn, googleSignIn, issueSignInNonce, login, register } from "./auth.controller.js";
import { appleRateLimiter, googleRateLimiter, loginRateLimiter, nonceRateLimiter, registerRateLimiter } from "./auth.rateLimits.js";
import { appleSignInSchema, googleSignInSchema, loginSchema, nonceRequestSchema, registerSchema } from "./auth.schemas.js";

const router = Router();

// Each route is rate-limited per IP before validation, so malformed floods count too.
router.post("/register", registerRateLimiter.middleware, validateBody(registerSchema), register);
router.post("/login", loginRateLimiter.middleware, validateBody(loginSchema), login);
router.post("/nonce", nonceRateLimiter.middleware, validateBody(nonceRequestSchema), issueSignInNonce);
router.post("/google", googleRateLimiter.middleware, validateBody(googleSignInSchema), googleSignIn);
router.post("/apple", appleRateLimiter.middleware, validateBody(appleSignInSchema), appleSignIn);

export default router;
