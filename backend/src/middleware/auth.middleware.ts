import { Response, NextFunction } from "express";
import { verifySessionToken } from "../modules/auth/session.js";
import { AuthenticatedRequest } from "../types/auth.types.js";

export function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({
      message: "Authentication required.",
    });
  }

  const [scheme, token] = authHeader.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({
      message: "Invalid authorization format.",
    });
  }

  try {
    // HS256 only (session.ts): tokens signed any other way are rejected.
    req.userId = verifySessionToken(token).userId;

    next();
  } catch {
    return res.status(401).json({
      message: "Invalid or expired token.",
    });
  }
}