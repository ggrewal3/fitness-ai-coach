// Optional, in-process observation of one coach request, for the opt-in
// evaluation harness (ADR-027). Production never supplies an observer: the
// service then behaves and logs exactly as without this module.
//
// Events carry only what the orchestrator already has: provider metadata,
// validated tool arguments, outcomes and successful tool output. Observers
// receive copies, are never awaited, and their errors are swallowed, so they
// cannot change tool results, the model's input or the response. Nothing an
// observer receives is ever logged.
import type { TokenUsage } from "./model.provider.js";

export type CoachToolOutcome =
  | "ok"
  | "cached"
  | "unknown_tool"
  | "invalid_arguments"
  | "error"
  | "too_large"
  | "turn_cap"
  | "request_cap";

/** One provider call that returned (failed calls end the request; see `request_completed`). */
export interface CoachProviderTurnEvent {
  type: "provider_turn";
  requestId: string;
  /** 1-based provider call number within the request. */
  turn: number;
  kind: "final" | "tool_calls";
  /** Tool calls the model asked for in this turn (0 for a final turn). */
  requestedToolCalls: number;
  model: string;
  usage: TokenUsage | null;
  latencyMs: number;
}

/** One tool call the model asked for, after the orchestrator handled it. */
export interface CoachToolCallEvent {
  type: "tool_call";
  requestId: string;
  /** The provider turn that requested it. */
  turn: number;
  /** Registered tool name, or "unknown" for a name outside the allow-list. */
  toolName: string;
  /** Arguments after schema validation; null when the call was rejected before validation succeeded. */
  validatedArguments: Record<string, unknown> | null;
  outcome: CoachToolOutcome;
  /** A copy of what the model received, only for `ok` and `cached` outcomes. */
  output?: unknown;
  latencyMs: number;
}

export interface CoachRequestCompletedEvent {
  type: "request_completed";
  requestId: string;
  model: string;
  promptVersion: string;
  latencyMs: number;
  modelTurns: number;
  toolCallCount: number;
  usage: TokenUsage | null;
  success: boolean;
  failureCategory: string | null;
}

export type CoachObserverEvent = CoachProviderTurnEvent | CoachToolCallEvent | CoachRequestCompletedEvent;

export type CoachObserver = (event: CoachObserverEvent) => void;

/** Delivers a copy of the event; an observer can neither alter request state nor fail the request. */
export function notifyObserver(observer: CoachObserver | undefined, event: CoachObserverEvent): void {
  if (!observer) return;

  try {
    const result: unknown = observer(structuredClone(event));
    // An async observer's rejection must not surface as an unhandled rejection.
    if (result instanceof Promise) result.catch(() => undefined);
  } catch {
    // Observation is best effort and must never affect the request.
  }
}
