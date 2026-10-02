import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react"
import { buildCoachHistory } from "../features/coach/coachHistory"
import { getCoachClientContext } from "../features/coach/coachClientContext"
import { coachErrorFor, coachReducer, EMPTY_COACH_STATE, timezoneError, type CoachState } from "../features/coach/coachConversation"
import { clearConversation, loadConversation, saveConversation } from "../features/coach/coachStorage"
import { COACH_LIMITS, isCompletedMessage, type CoachMessage } from "../features/coach/coachTypes"
import { ApiRequestError, getStoredAuthUserId } from "../services/api"
import { askCoach } from "../services/coach"
import { CoachConversationContext, type CoachConversationContextValue } from "./coach-conversation-context"

type CoachConversationProviderProps = {
  children: ReactNode
}

function safeSessionStorage(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

function createId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/**
 * The AI Coach conversation for the signed-in user (ADR-026). Mounted by
 * AppLayout, so it survives route changes and unmounts on sign-out.
 *
 * - It is restored from, and saved to, this tab's sessionStorage, scoped to
 *   the account that owns it (the stored token's user id).
 * - One request at a time. The request belongs to the provider, so leaving the
 *   Coach page does not abandon it.
 * - Unmounting (sign-out) or New conversation aborts the request; a
 *   generation counter and an owner check stop late responses from changing
 *   state or rewriting storage.
 */
export function CoachConversationProvider({ children }: CoachConversationProviderProps) {
  // The account this conversation belongs to, fixed for the provider's life.
  // Without a readable owner nothing is restored or saved (memory only).
  const [ownerId] = useState(() => getStoredAuthUserId())
  const [state, dispatch] = useReducer(coachReducer, ownerId, (owner): CoachState => {
    const storage = safeSessionStorage()
    return owner !== null && storage ? { ...EMPTY_COACH_STATE, messages: loadConversation(storage, owner) } : EMPTY_COACH_STATE
  })

  const stateRef = useRef(state)
  const generationRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(false)

  useEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    mountedRef.current = true

    return () => {
      mountedRef.current = false
      generationRef.current += 1
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [])

  // Persist when the completed conversation changes (once per exchange), and
  // only while the same account is still signed in.
  const completedKey = state.messages.filter(isCompletedMessage).map((message) => message.id).join(",")
  useEffect(() => {
    const storage = safeSessionStorage()

    if (ownerId === null || !storage || getStoredAuthUserId() !== ownerId) {
      return
    }

    saveConversation(storage, ownerId, stateRef.current.messages)
  }, [completedKey, ownerId])

  const request = useCallback(async (questionId: string, content: string, history: ReturnType<typeof buildCoachHistory>, clientContext: { today: string; timeZone: string }) => {
    const generation = generationRef.current
    const controller = new AbortController()
    abortRef.current = controller
    const isCurrent = () => mountedRef.current && generation === generationRef.current

    try {
      const reply = await askCoach({ message: content, clientContext, history }, controller.signal)

      if (!isCurrent()) return

      // Never render or store a reply that does not match the contract.
      if (
        typeof reply?.answer !== "string" ||
        !reply.answer.trim() ||
        !Array.isArray(reply.actionItems) ||
        !reply.actionItems.every((item) => typeof item === "string") ||
        !(reply.followUpQuestion === null || typeof reply.followUpQuestion === "string") ||
        !Array.isArray(reply.sources)
      ) {
        dispatch({ type: "requestFailed", questionId, error: coachErrorFor(502) })
        return
      }

      dispatch({
        type: "replyReceived",
        questionId,
        reply: {
          id: createId(),
          role: "assistant",
          createdAt: new Date().toISOString(),
          answer: reply.answer,
          actionItems: reply.actionItems,
          followUpQuestion: reply.followUpQuestion,
          sources: reply.sources.map(({ type, startDate, endDate }) => ({ type, startDate, endDate })),
        },
      })
    } catch (error) {
      if (!isCurrent() || controller.signal.aborted) return

      dispatch({
        type: "requestFailed",
        questionId,
        error:
          error instanceof ApiRequestError
            ? coachErrorFor(error.status, error.retryAfterSeconds)
            : coachErrorFor(null),
      })
    } finally {
      if (abortRef.current === controller) abortRef.current = null
    }
  }, [])

  const send = useCallback(
    (text: string): boolean => {
      const content = text.trim()

      if (!content || content.length > COACH_LIMITS.maxMessageChars || stateRef.current.pendingId) {
        return false
      }

      const id = createId()
      const createdAt = new Date().toISOString()
      const context = getCoachClientContext()

      // Without the user's timezone the answer could be about the wrong days:
      // keep the question, explain, and do not call the API.
      if (!context.ok) {
        dispatch({ type: "sendFailedBeforeRequest", id, content, createdAt, error: timezoneError() })
        return true
      }

      // History is built before the new question is added, from completed
      // messages only, so the current question can never appear in it.
      const history = buildCoachHistory(stateRef.current.messages)
      dispatch({ type: "sendStarted", id, content, createdAt })
      stateRef.current = { ...stateRef.current, pendingId: id }
      void request(id, content, history, context.context)
      return true
    },
    [request],
  )

  const retry = useCallback(
    (messageId: string) => {
      const current = stateRef.current
      const failed = current.messages.find(
        (message): message is Extract<CoachMessage, { role: "user" }> =>
          message.id === messageId && message.role === "user" && message.status === "failed",
      )

      if (!failed || current.pendingId) return
      if (failed.error?.retryAvailableAt && failed.error.retryAvailableAt > Date.now()) return

      const context = getCoachClientContext()
      if (!context.ok) {
        dispatch({ type: "retryFailedBeforeRequest", id: messageId, error: timezoneError() })
        return
      }

      // The failed question is not completed, so it is excluded: Retry sends
      // it again against exactly the same completed history.
      const history = buildCoachHistory(current.messages)
      dispatch({ type: "retryStarted", id: messageId })
      stateRef.current = { ...current, pendingId: messageId }
      void request(messageId, failed.content, history, context.context)
    },
    [request],
  )

  const edit = useCallback((messageId: string): string | null => {
    const failed = stateRef.current.messages.find(
      (message) => message.id === messageId && message.role === "user" && message.status === "failed",
    )

    if (!failed || failed.role !== "user") return null

    dispatch({ type: "failedRemoved", id: messageId })
    return failed.content
  }, [])

  const startNewConversation = useCallback(() => {
    generationRef.current += 1
    abortRef.current?.abort()
    abortRef.current = null
    stateRef.current = EMPTY_COACH_STATE
    dispatch({ type: "reset" })

    const storage = safeSessionStorage()
    if (storage) clearConversation(storage)
  }, [])

  const value = useMemo<CoachConversationContextValue>(
    () => ({
      messages: state.messages,
      isPending: state.pendingId !== null,
      send,
      retry,
      edit,
      startNewConversation,
    }),
    [state.messages, state.pendingId, send, retry, edit, startNewConversation],
  )

  return <CoachConversationContext.Provider value={value}>{children}</CoachConversationContext.Provider>
}
