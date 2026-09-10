import { z } from "zod";
import { coachRequestSchema, coachResponseSchema } from "./coach.schemas.js";

export type CoachRequest = z.infer<typeof coachRequestSchema>;
export type CoachResponse = z.infer<typeof coachResponseSchema>;
