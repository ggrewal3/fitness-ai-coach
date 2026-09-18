import { z } from "zod";

const trainingTypeSchema = z.enum([
  "STRENGTH",
  "CARDIO",
  "MOBILITY",
  "SPORT",
  "OTHER",
]);

const workoutSessionFieldsSchema = z.object({
  trainingType: trainingTypeSchema,
  durationMinutes: z.number().finite().int().min(1).max(1440),
  notes: z.string().trim().max(2000).optional(),
  recordedAt: z.iso.datetime({ offset: true }),
});

export const createWorkoutSessionSchema = workoutSessionFieldsSchema.strict();

export const updateWorkoutSessionSchema = z
  .object({
    trainingType: trainingTypeSchema.optional(),
    durationMinutes: workoutSessionFieldsSchema.shape.durationMinutes.optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    recordedAt: workoutSessionFieldsSchema.shape.recordedAt.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one workout field is required.",
  });
