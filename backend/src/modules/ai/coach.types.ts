import { z } from "zod";
import { coachRequestSchema, coachResponseSchema } from "./coach.schemas.js";
import type { CoachSource } from "./coach.sources.js";

/** A coach request; `history` may be omitted (it defaults to no earlier turns). */
export type CoachRequest = z.input<typeof coachRequestSchema>;
/** The model's validated structured output. */
export type CoachResponse = z.infer<typeof coachResponseSchema>;
/** What the API returns: the model's output plus server-derived sources. */
export type CoachApiResponse = CoachResponse & { sources: CoachSource[] };
