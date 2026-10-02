// Conversation state transitions and error mapping (pure; no network).
//
// Invariants:
// - at most one message is "sending" (one request at a time);
// - a failed message is always the last one, so an answer is always appended
//   right after its question; sending a new message drops a lingering failed one;
// - only completed messages are history or persisted (coachHistory, coachStorage).
import {
  COACH_LIMITS,
  type CoachAssistantMessage,
  type CoachErrorInfo,
  type CoachErrorKind,
  type CoachMessage,
} from "./coachTypes"

export type CoachState = {
  messages: CoachMessage[]
  /** The user message whose request is in flight. */
  pendingId: string | null
}

export type CoachAction =
  | { type: "sendStarted"; id: string; content: string; createdAt: string }
  | { type: "sendFailedBeforeRequest"; id: string; content: string; createdAt: string; error: CoachErrorInfo }
  | { type: "retryStarted"; id: string }
  | { type: "retryFailedBeforeRequest"; id: string; error: CoachErrorInfo }
  | { type: "replyReceived"; questionId: string; reply: CoachAssistantMessage }
  | { type: "requestFailed"; questionId: string; error: CoachErrorInfo }
  | { type: "failedRemoved"; id: string }
  | { type: "reset" }

export const EMPTY_COACH_STATE: CoachState = { messages: [], pendingId: null }

const withoutFailed = (messages: CoachMessage[]) =>
  messages.filter((message) => message.role === "assistant" || message.status !== "failed")

export function coachReducer(state: CoachState, action: CoachAction): CoachState {
  switch (action.type) {
    case "sendStarted":
      if (state.pendingId) return state
      return {
        messages: [
          ...withoutFailed(state.messages),
          { id: action.id, role: "user", content: action.content, createdAt: action.createdAt, status: "sending", error: null },
        ],
        pendingId: action.id,
      }

    case "sendFailedBeforeRequest":
      if (state.pendingId) return state
      return {
        ...state,
        messages: [
          ...withoutFailed(state.messages),
          { id: action.id, role: "user", content: action.content, createdAt: action.createdAt, status: "failed", error: action.error },
        ],
      }

    case "retryStarted": {
      const isFailed = state.messages.some((message) => message.id === action.id && message.role === "user" && message.status === "failed")
      if (state.pendingId || !isFailed) return state
      return {
        messages: state.messages.map((message) =>
          message.id === action.id && message.role === "user" ? { ...message, status: "sending", error: null } : message,
        ),
        pendingId: action.id,
      }
    }

    case "retryFailedBeforeRequest":
      return {
        ...state,
        messages: state.messages.map((message) =>
          message.id === action.id && message.role === "user" ? { ...message, status: "failed", error: action.error } : message,
        ),
      }

    case "replyReceived": {
      if (state.pendingId !== action.questionId) return state
      const messages = state.messages.map((message) =>
        message.id === action.questionId && message.role === "user" ? { ...message, status: "complete" as const, error: null } : message,
      )
      return { messages: [...messages, action.reply].slice(-COACH_LIMITS.maxStoredMessages), pendingId: null }
    }

    case "requestFailed":
      if (state.pendingId !== action.questionId) return state
      return {
        messages: state.messages.map((message) =>
          message.id === action.questionId && message.role === "user" ? { ...message, status: "failed", error: action.error } : message,
        ),
        pendingId: null,
      }

    case "failedRemoved":
      return {
        ...state,
        messages: state.messages.filter((message) => !(message.id === action.id && message.role === "user" && message.status === "failed")),
      }

    case "reset":
      return EMPTY_COACH_STATE
  }
}

const COPY: Record<CoachErrorKind, string> = {
  network: "Couldn’t reach FitAI. Check your connection and try again.",
  timezone: "FitAI couldn’t determine your timezone. Refresh the page and try again.",
  rejected: "This message couldn’t be sent. If this keeps happening, start a new conversation.",
  rateLimited: "You’ve sent a lot of messages. Please wait a moment and try again.",
  invalid: "FitAI couldn’t put an answer together. Try again or rephrase your question.",
  unavailable: "FitAI Coach is temporarily unavailable. Try again in a moment.",
  timeout: "FitAI took too long to respond. Try again, or ask about a shorter period.",
  unknown: "Something went wrong. Try again.",
}

/**
 * User-facing error for a failed request. `status` is the HTTP status (or
 * null for a network failure); `retryAfterSeconds` comes from Retry-After.
 */
export function coachErrorFor(
  status: number | null,
  retryAfterSeconds: number | null = null,
  now: number = Date.now(),
): CoachErrorInfo {
  const kind: CoachErrorKind =
    status === null || status === 0
      ? "network"
      : status === 400
        ? "rejected"
        : status === 429
          ? "rateLimited"
          : status === 502
            ? "invalid"
            : status === 503
              ? "unavailable"
              : status === 504
                ? "timeout"
                : "unknown"

  return {
    kind,
    message: COPY[kind],
    retryAvailableAt: kind === "rateLimited" && retryAfterSeconds ? now + retryAfterSeconds * 1000 : null,
  }
}

export function timezoneError(): CoachErrorInfo {
  return { kind: "timezone", message: COPY.timezone, retryAvailableAt: null }
}
