import { z } from "zod";

export const MAX_EXERCISES_PER_WORKOUT = 30;
export const MAX_SETS_PER_EXERCISE = 20;
export const MAX_REPS = 1000;
export const MAX_LOAD = 2000;
export const WORKOUT_LIST_DEFAULT_LIMIT = 20;
export const WORKOUT_LIST_MAX_LIMIT = 100;

const trainingTypeSchema = z.enum([
  "STRENGTH",
  "CARDIO",
  "MOBILITY",
  "SPORT",
  "OTHER",
]);

const loadUnitSchema = z.enum(["KG", "LB"]);

// workoutDate (the logical training day) and recordedAt (the session's own
// timestamp) are independent, mirroring Nutrition's entryDate.
export const workoutDateSchema = z.iso.date();

// Integer-scaled check rather than multipleOf(0.01), which is unreliable with
// binary floating point (e.g. 155.35).
function hasAtMostTwoDecimals(value: number): boolean {
  const scaled = value * 100;
  return Math.abs(scaled - Math.round(scaled)) < 1e-6;
}

const workoutSetSchema = z
  .object({
    reps: z.number().finite().int().min(1).max(MAX_REPS),
    load: z
      .number()
      .finite()
      .positive()
      .max(MAX_LOAD)
      .refine(hasAtMostTwoDecimals, {
        message: "Load may have at most 2 decimal places.",
      })
      .nullable()
      .optional(),
    loadUnit: loadUnitSchema.nullable().optional(),
  })
  .strict()
  .superRefine((set, context) => {
    const hasLoad = set.load !== undefined && set.load !== null;
    const hasUnit = set.loadUnit !== undefined && set.loadUnit !== null;

    if (hasLoad && !hasUnit) {
      context.addIssue({
        code: "custom",
        path: ["loadUnit"],
        message: "loadUnit is required when load is provided.",
      });
    }

    if (!hasLoad && hasUnit) {
      context.addIssue({
        code: "custom",
        path: ["loadUnit"],
        message: "loadUnit must be empty when load is empty.",
      });
    }
  });

const workoutExerciseSchema = z
  .object({
    exerciseId: z.number().finite().int().positive(),
    sets: z.array(workoutSetSchema).min(1).max(MAX_SETS_PER_EXERCISE),
  })
  .strict();

const workoutExercisesSchema = z
  .array(workoutExerciseSchema)
  .max(MAX_EXERCISES_PER_WORKOUT);

const workoutSessionFieldsSchema = z.object({
  title: z.string().trim().min(1).max(100),
  workoutDate: workoutDateSchema,
  trainingType: trainingTypeSchema,
  durationMinutes: z.number().finite().int().min(1).max(1440),
  notes: z.string().trim().max(2000).optional(),
  recordedAt: z.iso.datetime({ offset: true }),
});

export const createWorkoutSessionSchema = workoutSessionFieldsSchema
  .extend({
    exercises: workoutExercisesSchema.default([]),
  })
  .strict();

// When `exercises` is present it replaces every nested exercise/set of the
// session ([] clears them); when absent, nested data is left untouched.
export const updateWorkoutSessionSchema = z
  .object({
    title: workoutSessionFieldsSchema.shape.title.optional(),
    workoutDate: workoutDateSchema.optional(),
    trainingType: trainingTypeSchema.optional(),
    durationMinutes: workoutSessionFieldsSchema.shape.durationMinutes.optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    recordedAt: workoutSessionFieldsSchema.shape.recordedAt.optional(),
    exercises: workoutExercisesSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one workout field is required.",
  });

export const workoutListQuerySchema = z
  .object({
    from: workoutDateSchema.optional(),
    to: workoutDateSchema.optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(WORKOUT_LIST_MAX_LIMIT)
      .default(WORKOUT_LIST_DEFAULT_LIMIT),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: "from must be on or before to.",
    path: ["from"],
  });
