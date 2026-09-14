import { z } from "zod";

const nutritionEntryFieldsSchema = z.object({
  calories: z.number().finite().int().positive().max(15000),
  proteinGrams: z.number().finite().nonnegative().max(1000),
  carbsGrams: z.number().finite().nonnegative().max(2000),
  fatGrams: z.number().finite().nonnegative().max(1000),
  recordedAt: z.iso.datetime({ offset: true }),
});

export const createNutritionEntrySchema = nutritionEntryFieldsSchema.strict();

export const updateNutritionEntrySchema = nutritionEntryFieldsSchema
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one nutrition field is required.",
  });
