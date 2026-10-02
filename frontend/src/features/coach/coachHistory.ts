// Turns the completed conversation into the text history the API accepts
// (ADR-026). Deterministic and always within the backend limits, so a valid
// conversation never earns a 400.
import type { CoachHistoryTurn } from "../../services/api"
import {
  COACH_LIMITS,
  isCompletedMessage,
  type CoachAssistantMessage,
  type CoachMessage,
} from "./coachTypes"

/**
 * An assistant reply as text. Action items keep "what should I change?"
 * answerable; the follow-up question keeps a bare "Yes" answerable.
 */
export function flattenAssistantMessage(message: Pick<CoachAssistantMessage, "answer" | "actionItems" | "followUpQuestion">): string {
  const parts = [message.answer.trim()]

  if (message.actionItems.length > 0) {
    parts.push(`Action items:\n${message.actionItems.map((item) => `- ${item.trim()}`).join("\n")}`)
  }

  if (message.followUpQuestion?.trim()) {
    parts.push(`Follow-up question: ${message.followUpQuestion.trim()}`)
  }

  return parts.join("\n\n")
}

/**
 * Trimmed text of at most `max` UTF-16 units (the backend measures the same
 * way). Longer text keeps its start and ends with "…", never splitting a
 * surrogate pair.
 */
export function truncateForHistory(text: string, max: number): string {
  const trimmed = text.trim()

  if (trimmed.length <= max) {
    return trimmed
  }

  let cut = trimmed.slice(0, max - 1)
  const last = cut.charCodeAt(cut.length - 1)

  if (last >= 0xd800 && last <= 0xdbff) {
    cut = cut.slice(0, -1)
  }

  return `${cut.trimEnd()}…`
}

/**
 * History for the next request, oldest first. Only completed messages count,
 * so the message being sent (or retried) and failed messages are never
 * included. The newest turns are kept while they fit the turn and total
 * limits; the first one that does not fit ends the window, so the history is
 * always a contiguous recent slice.
 */
export function buildCoachHistory(messages: readonly CoachMessage[]): CoachHistoryTurn[] {
  const turns: CoachHistoryTurn[] = messages.filter(isCompletedMessage).map((message) =>
    message.role === "user"
      ? { role: "user", content: truncateForHistory(message.content, COACH_LIMITS.historyMaxUserChars) }
      : { role: "assistant", content: truncateForHistory(flattenAssistantMessage(message), COACH_LIMITS.historyMaxAssistantChars) },
  )

  const kept: CoachHistoryTurn[] = []
  let total = 0

  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index]

    if (
      turn.content.length === 0 ||
      kept.length >= COACH_LIMITS.historyMaxMessages ||
      total + turn.content.length > COACH_LIMITS.historyMaxTotalChars
    ) {
      break
    }

    kept.push(turn)
    total += turn.content.length
  }

  return kept.reverse()
}
