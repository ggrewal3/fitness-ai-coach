import { z } from "zod";

export const coachRequestSchema = z.object({
  message: z.string().trim().min(1).max(2000),
});

export const coachResponseSchema = z.object({
  answer: z.string().min(1),
  actionItems: z.array(z.string().min(1)).max(5),
  followUpQuestion: z.string().nullable(),
});
