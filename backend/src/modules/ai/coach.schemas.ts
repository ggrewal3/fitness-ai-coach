import { z } from "zod";
import { clientContextSchema } from "./coach.context.js";
import { COACH_HISTORY_LIMITS } from "./coach.limits.js";

const MAX_CHARS_BY_ROLE = {
  user: COACH_HISTORY_LIMITS.maxUserChars,
  assistant: COACH_HISTORY_LIMITS.maxAssistantChars,
} as const;

/**
 * One earlier turn as plain text (ADR-026). Client-supplied and untrusted:
 * it gives the model conversational context, never evidence about logged data.
 */
const conversationTurnSchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: z.string().trim().min(1),
  })
  .strict()
  .superRefine((turn, context) => {
    const max = MAX_CHARS_BY_ROLE[turn.role];

    if (turn.content.length > max) {
      context.addIssue({
        code: "custom",
        path: ["content"],
        message: `A ${turn.role} message in history may be at most ${max} characters.`,
      });
    }
  });

/**
 * Earlier turns, oldest first, without the current message. Roles need not
 * alternate (retries can repeat a role). Oversized history is rejected, never
 * trimmed: the client trims oldest-first.
 */
const historySchema = z
  .array(conversationTurnSchema)
  // Checked here rather than with .max(): Zod would otherwise also apply the
  // length check to a non-array value and report a misleading second error.
  .superRefine((turns, context) => {
    if (turns.length > COACH_HISTORY_LIMITS.maxMessages) {
      context.addIssue({
        code: "custom",
        message: `History may contain at most ${COACH_HISTORY_LIMITS.maxMessages} messages.`,
      });
    }

    const total = turns.reduce((sum, turn) => sum + turn.content.length, 0);

    if (total > COACH_HISTORY_LIMITS.maxTotalChars) {
      context.addIssue({
        code: "custom",
        message: `History may contain at most ${COACH_HISTORY_LIMITS.maxTotalChars} characters in total.`,
      });
    }
  });

export const coachRequestSchema = z
  .object({
    message: z.string().trim().min(1).max(2000),
    clientContext: clientContextSchema,
    history: historySchema.default([]),
  })
  .strict();

/** The model's structured output. Sources are added by the server, never by the model. */
export const coachResponseSchema = z.object({
  answer: z.string().min(1),
  actionItems: z.array(z.string().min(1)).max(5),
  followUpQuestion: z.string().nullable(),
});
