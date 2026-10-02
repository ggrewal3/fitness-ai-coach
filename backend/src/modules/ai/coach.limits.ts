// Named limits for the AI Coach (ADR-019). Changing a value here changes
// documented behavior: update docs/AI-SYSTEM.md in the same change.

export const COACH_LIMITS = {
  /**
   * Provider calls per request. The first call plus up to 4 tool rounds; a
   * valid final answer on the last permitted call is accepted. If that call
   * still asks for tools, the request fails (502).
   */
  maxModelTurns: 5,
  /** Tool calls honored in one model turn; extra calls get an error result. */
  maxToolCallsPerTurn: 4,
  /** Tool calls honored in one request; extra calls get an error result. */
  maxToolCallsPerRequest: 8,
  /** Hard cap on one serialized tool result; larger results are replaced by an error. */
  maxToolResultChars: 32_000,
  /** Whole-request deadline, across all model calls and tools (504 after). */
  requestDeadlineMs: 45_000,
} as const;

export type CoachLimits = { -readonly [K in keyof typeof COACH_LIMITS]: number };

export const PROVIDER_TIMEOUT_MS = 25_000;
export const PROVIDER_MAX_RETRIES = 1;

/** Largest `days` window any history tool accepts. */
export const TOOL_MAX_DAYS = 90;
