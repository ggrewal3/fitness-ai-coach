import { z } from "zod";
import { toDisplayName } from "./exercise.normalize.js";

export const EXERCISE_NAME_MIN_LENGTH = 2;
export const EXERCISE_NAME_MAX_LENGTH = 60;
export const EXERCISE_SEARCH_MAX_LENGTH = 60;
export const EXERCISE_SEARCH_DEFAULT_LIMIT = 20;
export const EXERCISE_SEARCH_MAX_LIMIT = 50;

// Letters, numbers, spaces and a small set of punctuation common in exercise
// names (e.g. "EZ-Bar Curl", "Farmer's Carry", "90/90 Hip Switch").
const EXERCISE_NAME_ALLOWED = /^[\p{L}\p{N} \-'’()/&.,+]+$/u;
const HAS_LETTER_OR_NUMBER = /[\p{L}\p{N}]/u;

export const createExerciseSchema = z
  .object({
    name: z
      .string()
      .max(200)
      .transform(toDisplayName)
      .pipe(
        z
          .string()
          .min(EXERCISE_NAME_MIN_LENGTH)
          .max(EXERCISE_NAME_MAX_LENGTH)
          .regex(EXERCISE_NAME_ALLOWED, {
            message:
              "Exercise name may only contain letters, numbers, spaces and - ' ( ) / & . , +",
          })
          .regex(HAS_LETTER_OR_NUMBER, {
            message: "Exercise name must contain a letter or number.",
          })
      ),
  })
  .strict();

// Query-string values arrive as strings (or arrays when repeated, which is
// rejected), so limit is coerced.
export const exerciseSearchQuerySchema = z.object({
  search: z.string().max(EXERCISE_SEARCH_MAX_LENGTH).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(EXERCISE_SEARCH_MAX_LIMIT)
    .default(EXERCISE_SEARCH_DEFAULT_LIMIT),
});
