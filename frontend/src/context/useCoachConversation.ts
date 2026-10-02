import { useContext } from "react"
import { CoachConversationContext } from "./coach-conversation-context"

export function useCoachConversation() {
  const context = useContext(CoachConversationContext)

  if (!context) {
    throw new Error("useCoachConversation must be used within a CoachConversationProvider")
  }

  return context
}
