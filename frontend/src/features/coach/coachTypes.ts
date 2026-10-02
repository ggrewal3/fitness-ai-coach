// The AI Coach conversation as the UI sees it (ADR-026). The API's history is
// plain text; these messages carry what the UI renders. Only completed
// messages are ever persisted or sent as history.
import type { CoachSource } from "../../services/api"

/** Mirrors the backend contract (coach.schemas.ts, coach.limits.ts). */
export const COACH_LIMITS = {
  maxMessageChars: 2000,
  historyMaxMessages: 10,
  historyMaxUserChars: 2000,
  historyMaxAssistantChars: 4000,
  historyMaxTotalChars: 12_000,
  /** Messages kept in the tab (and in sessionStorage). */
  maxStoredMessages: 60,
} as const

export type CoachErrorKind =
  | "network"
  | "timezone"
  | "rejected"
  | "rateLimited"
  | "invalid"
  | "unavailable"
  | "timeout"
  | "unknown"

/** Ephemeral: never persisted. */
export type CoachErrorInfo = {
  kind: CoachErrorKind
  message: string
  /** Epoch ms before which Retry stays disabled (429 with Retry-After). */
  retryAvailableAt: number | null
}

export type CoachUserMessage = {
  id: string
  role: "user"
  content: string
  createdAt: string
  /** "complete" once answered; only complete messages are history or persisted. */
  status: "sending" | "failed" | "complete"
  error: CoachErrorInfo | null
}

export type CoachAssistantMessage = {
  id: string
  role: "assistant"
  createdAt: string
  answer: string
  actionItems: string[]
  followUpQuestion: string | null
  sources: CoachSource[]
}

export type CoachMessage = CoachUserMessage | CoachAssistantMessage

/** A message that is part of the completed conversation. */
export function isCompletedMessage(message: CoachMessage): boolean {
  return message.role === "assistant" || message.status === "complete"
}
