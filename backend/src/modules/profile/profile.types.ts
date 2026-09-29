import type { z } from "zod";
import type {
  createFitnessProfileSchema,
  updateFitnessProfileSchema,
} from "./profile.schemas.js";

// Validated (post-transform) input: dateOfBirth is already a Date, blank
// medicalNotes are null, and null clears a field.
export type CreateFitnessProfileInput = z.output<typeof createFitnessProfileSchema>;
export type UpdateFitnessProfileInput = z.output<typeof updateFitnessProfileSchema>;
