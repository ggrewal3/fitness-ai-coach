import { z } from "zod";

export const createCheckInSchema = z.object({
  weightKg: z.number().finite().positive().max(500),
  recordedAt: z.iso.datetime({ offset: true }),
});
