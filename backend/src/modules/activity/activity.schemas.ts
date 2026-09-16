import { z } from "zod";

const dailyActivityFieldsSchema = z.object({
  steps: z.number().finite().int().min(0).max(200000),
  walkingDistanceKm: z.number().finite().min(0).max(500).optional(),
  activeCalories: z.number().finite().int().min(0).max(20000).optional(),
  recordedAt: z.iso.datetime({ offset: true }),
});

export const createDailyActivitySchema = dailyActivityFieldsSchema.strict();

export const updateDailyActivitySchema = dailyActivityFieldsSchema
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one activity field is required.",
  });
