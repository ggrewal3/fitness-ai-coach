import { NextFunction, Request, Response } from "express";
import { z } from "zod";

export function validateBody(schema: z.ZodType) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const errors = result.error.issues.map((issue) => ({
        field: issue.path.join(".") || "body",
        message: issue.message,
      }));

      return res.status(400).json({
        message: "Validation failed.",
        errors,
      });
    }

    req.body = result.data;
    next();
  };
}
