import type { ZodType } from "zod";
import type { BodyWeightUnit, HeightUnit } from "../../../lib/units/displayUnits.js";

/**
 * Server-side context for every tool call. `userId` comes from the JWT and
 * the calendar context from the validated client context: never from the model.
 */
export interface ToolExecutionContext {
  userId: number;
  /** The user's local date (YYYY-MM-DD). */
  today: string;
  /** Canonical IANA timezone. */
  timeZone: string;
  /** Display preferences only; stored values stay canonical (ADR-006). */
  units: { bodyWeightUnit: BodyWeightUnit; heightUnit: HeightUnit };
}

export interface ToolDefinition<TArgs = unknown, TResult = unknown> {
  name: string;
  description: string;
  inputSchema: ZodType<TArgs>;
  execute(
    validatedArgs: TArgs,
    context: ToolExecutionContext
  ): Promise<TResult>;
}
