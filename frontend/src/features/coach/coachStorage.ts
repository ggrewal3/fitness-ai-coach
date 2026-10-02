// The active Coach conversation in this tab's sessionStorage (ADR-026).
//
// - The key is user-scoped (fitai.user.*), so sign-out clears it.
// - The envelope records the owner's user id; a conversation belonging to
//   anyone else, an unknown version or anything malformed is discarded whole.
// - Only completed messages are stored (no pending/failed state, errors,
//   prompts, tool names or tokens), newest 60.
// - Storage can be unavailable or full: every call fails soft, and the Coach
//   keeps working from memory.
import { USER_SCOPED_STORAGE_PREFIX } from "../auth/userSession"
import type { CoachSource } from "../../services/api"
import {
  COACH_LIMITS,
  isCompletedMessage,
  type CoachAssistantMessage,
  type CoachMessage,
  type CoachUserMessage,
} from "./coachTypes"

export const COACH_STORAGE_KEY = `${USER_SCOPED_STORAGE_PREFIX}coach.conversation.v1`
const STORAGE_VERSION = 1

type ConversationStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">

type StoredUserMessage = Pick<CoachUserMessage, "id" | "role" | "content" | "createdAt">
type StoredAssistantMessage = CoachAssistantMessage
type StoredMessage = StoredUserMessage | StoredAssistantMessage

const SOURCE_TYPES = new Set(["profile", "weight", "nutrition", "activity", "workouts"])
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null
const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0
const isDateOrNull = (value: unknown) => value === null || (typeof value === "string" && DATE_PATTERN.test(value))

function isSource(value: unknown): value is CoachSource {
  return isRecord(value) && SOURCE_TYPES.has(value.type as string) && isDateOrNull(value.startDate) && isDateOrNull(value.endDate)
}

function parseMessage(value: unknown): CoachMessage | null {
  if (!isRecord(value) || !isNonEmptyString(value.id) || typeof value.createdAt !== "string") {
    return null
  }

  if (value.role === "user" && isNonEmptyString(value.content) && value.content.length <= COACH_LIMITS.maxMessageChars) {
    return { id: value.id, role: "user", content: value.content, createdAt: value.createdAt, status: "complete", error: null }
  }

  if (
    value.role === "assistant" &&
    isNonEmptyString(value.answer) &&
    Array.isArray(value.actionItems) &&
    value.actionItems.every((item) => typeof item === "string") &&
    (value.followUpQuestion === null || typeof value.followUpQuestion === "string") &&
    Array.isArray(value.sources) &&
    value.sources.every(isSource)
  ) {
    return {
      id: value.id,
      role: "assistant",
      createdAt: value.createdAt,
      answer: value.answer,
      actionItems: value.actionItems as string[],
      followUpQuestion: value.followUpQuestion as string | null,
      sources: (value.sources as CoachSource[]).map(({ type, startDate, endDate }) => ({ type, startDate, endDate })),
    }
  }

  return null
}

/** The stored conversation if it is valid and belongs to `userId`; otherwise null. */
export function parseStoredConversation(raw: string | null, userId: number): CoachMessage[] | null {
  if (!raw) return null

  let envelope: unknown
  try {
    envelope = JSON.parse(raw)
  } catch {
    return null
  }

  if (
    !isRecord(envelope) ||
    envelope.version !== STORAGE_VERSION ||
    envelope.userId !== userId ||
    !Array.isArray(envelope.messages) ||
    envelope.messages.length > COACH_LIMITS.maxStoredMessages
  ) {
    return null
  }

  const messages = envelope.messages.map(parseMessage)
  return messages.every((message): message is CoachMessage => message !== null) ? messages : null
}

/** The envelope for `userId`: completed messages only, newest kept. */
export function serializeConversation(userId: number, messages: readonly CoachMessage[]): string {
  const stored: StoredMessage[] = messages
    .filter(isCompletedMessage)
    .slice(-COACH_LIMITS.maxStoredMessages)
    .map((message) =>
      message.role === "user"
        ? { id: message.id, role: "user", content: message.content, createdAt: message.createdAt }
        : message,
    )

  return JSON.stringify({ version: STORAGE_VERSION, userId, messages: stored })
}

/** Restores the conversation; anything unusable is removed and an empty conversation returned. */
export function loadConversation(storage: ConversationStorage, userId: number): CoachMessage[] {
  try {
    const raw = storage.getItem(COACH_STORAGE_KEY)
    const messages = parseStoredConversation(raw, userId)

    if (raw !== null && messages === null) {
      storage.removeItem(COACH_STORAGE_KEY)
    }

    return messages ?? []
  } catch {
    return []
  }
}

/** Saves completed messages; returns false if storage is unavailable or full. */
export function saveConversation(storage: ConversationStorage, userId: number, messages: readonly CoachMessage[]): boolean {
  try {
    if (!messages.some(isCompletedMessage)) {
      storage.removeItem(COACH_STORAGE_KEY)
    } else {
      storage.setItem(COACH_STORAGE_KEY, serializeConversation(userId, messages))
    }
    return true
  } catch {
    return false
  }
}

export function clearConversation(storage: ConversationStorage): void {
  try {
    storage.removeItem(COACH_STORAGE_KEY)
  } catch {
    // Nothing to clear.
  }
}
