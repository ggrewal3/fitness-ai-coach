import { z } from "zod";

const mealTypeSchema = z.enum(["BREAKFAST", "LUNCH", "DINNER", "SNACK", "OTHER"]);

const nutritionSourceSchema = z.enum(["MANUAL", "AI_TEXT", "AI_PHOTO"]);

// entryDate (the logical nutrition day) and recordedAt (the food record's own
// timestamp) are independent domain concepts, so entryDate is its own
// client-supplied "YYYY-MM-DD" field rather than being derived from
// recordedAt.
const entryDateSchema = z.iso.date();

const nutritionFoodItemFieldsSchema = z.object({
  foodName: z.string().trim().min(1).max(200),
  quantity: z.number().finite().positive().max(100000),
  unit: z.string().trim().min(1).max(20),
  calories: z.number().finite().int().positive().max(15000),
  proteinGrams: z.number().finite().nonnegative().max(1000),
  carbsGrams: z.number().finite().nonnegative().max(2000),
  fatGrams: z.number().finite().nonnegative().max(1000),
  mealType: mealTypeSchema,
  source: nutritionSourceSchema,
  entryDate: entryDateSchema,
  recordedAt: z.iso.datetime({ offset: true }),
});

export const createNutritionFoodItemSchema = nutritionFoodItemFieldsSchema
  .extend({
    source: nutritionSourceSchema.default("MANUAL"),
  })
  .strict();

export const updateNutritionFoodItemSchema = nutritionFoodItemFieldsSchema
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one nutrition field is required.",
  });

export const nutritionSummaryDateParamSchema = entryDateSchema;
