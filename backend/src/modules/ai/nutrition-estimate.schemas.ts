import { z } from "zod";

export const nutritionEstimateRequestSchema = z
  .object({
    foodName: z.string().trim().min(1).max(200),
    quantity: z.number().finite().positive().max(100000),
    unit: z.string().trim().min(1).max(20),
  })
  .strict();

// What the model itself must return. Deliberately excludes foodName/quantity/
// unit - the service reattaches the caller's own validated values for those
// rather than trusting the model to echo them back unchanged, so an estimate
// can never silently misrepresent what was actually asked for.
export const nutritionEstimateModelOutputSchema = z.object({
  calories: z.number().finite().int().nonnegative().max(15000),
  proteinGrams: z.number().finite().nonnegative().max(1000),
  carbsGrams: z.number().finite().nonnegative().max(2000),
  fatGrams: z.number().finite().nonnegative().max(1000),
  note: z.string().max(300).nullable(),
});

export const nutritionEstimateResultSchema = z.object({
  foodName: z.string().min(1).max(200),
  quantity: z.number().finite().positive().max(100000),
  unit: z.string().min(1).max(20),
  calories: z.number().finite().int().nonnegative().max(15000),
  proteinGrams: z.number().finite().nonnegative().max(1000),
  carbsGrams: z.number().finite().nonnegative().max(2000),
  fatGrams: z.number().finite().nonnegative().max(1000),
  note: z.string().max(300).nullable(),
});
