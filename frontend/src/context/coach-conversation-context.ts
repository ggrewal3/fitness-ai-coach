import { createContext } from "react"
import type { CoachMessage } from "../features/coach/coachTypes"

export type CoachConversationContextValue = {
  messages: CoachMessage[]
  /** True while the single allowed request is in flight. */
  isPending: boolean
  /** Sends a new question; returns false if it was not accepted (blank, too long, busy). */
  send: (text: string) => boolean
  /** Resends a failed question against the same completed history. */
  retry: (messageId: string) => void
  /** Removes a failed question and returns its text for the composer. */
  edit: (messageId: string) => string | null
  /** Clears the conversation in this tab (no server call; nothing is stored there). */
  startNewConversation: () => void
}

export const CoachConversationContext = createContext<CoachConversationContextValue | undefined>(undefined)
