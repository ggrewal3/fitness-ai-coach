import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import CoachComposer, { type CoachComposerHandle } from '../components/coach/CoachComposer'
import CoachEmptyState from '../components/coach/CoachEmptyState'
import CoachReply from '../components/coach/CoachReply'
import CoachThinking from '../components/coach/CoachThinking'
import CoachUserMessage from '../components/coach/CoachUserMessage'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import { ArrowDownIcon, PlusIcon } from '../components/ui/icons'
import { useCoachConversation } from '../context/useCoachConversation'
import type { CoachMessage } from '../features/coach/coachTypes'

/**
 * Live-region text for the newest message. Repeated texts alternate a
 * trailing no-break space so screen readers announce them again.
 */
function announcementFor(message: CoachMessage | undefined, count: number): string {
  if (!message) return ''

  const text =
    message.role === 'assistant'
      ? 'FitAI replied.'
      : message.status === 'sending'
        ? 'Message sent. FitAI is reviewing your data.'
        : message.status === 'failed' && message.error
          ? message.error.message
          : ''

  return text && count % 2 === 0 ? `${text}\u00a0` : text
}

/** Within this distance of the bottom, new content may scroll into view. */
const NEAR_BOTTOM_PX = 160

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function isNearBottom(): boolean {
  const root = document.documentElement
  return root.scrollHeight - (window.scrollY + window.innerHeight) < NEAR_BOTTOM_PX
}

function scrollToBottom(smooth: boolean) {
  window.scrollTo({ top: document.documentElement.scrollHeight, behavior: smooth && !prefersReducedMotion() ? 'smooth' : 'auto' })
}

// The AI Coach (ADR-026). The page scrolls as a whole; the composer is sticky
// at the bottom. The conversation itself lives in CoachConversationProvider,
// so it survives leaving this page.
function AICoachPage() {
  const { messages, isPending, send, retry, edit, startNewConversation } = useCoachConversation()
  const composerRef = useRef<CoachComposerHandle>(null)
  const replyRefs = useRef(new Map<string, HTMLElement>())
  const nearBottomRef = useRef(true)
  const [showJump, setShowJump] = useState(false)
  const [isConfirmingNew, setIsConfirmingNew] = useState(false)
  const lastMessage = messages.at(-1)
  const lastKey = lastMessage ? `${lastMessage.id}:${lastMessage.role === 'user' ? lastMessage.status : 'reply'}` : ''
  const previousKeyRef = useRef<string | null>(null)
  // Whatever was already showing when the page opened is not announced again.
  const [mountedKey] = useState(lastKey)
  const announcement = lastKey === mountedKey ? '' : announcementFor(lastMessage, messages.length)

  // Track whether the reader is at the bottom (before new content arrives).
  useEffect(() => {
    function handleScroll() {
      nearBottomRef.current = isNearBottom()
      if (nearBottomRef.current) setShowJump(false)
    }

    handleScroll()
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  // Arriving (or returning) shows the latest message (once, on mount).
  const [hadMessagesOnMount] = useState(messages.length > 0)
  useLayoutEffect(() => {
    if (hadMessagesOnMount) scrollToBottom(false)
  }, [hadMessagesOnMount])

  // React to the newest message changing: scroll, offer "Jump to latest", announce.
  useLayoutEffect(() => {
    const previousKey = previousKeyRef.current
    previousKeyRef.current = lastKey

    if (previousKey === null || previousKey === lastKey || !lastMessage) {
      return
    }

    if (lastMessage.role === 'user' && lastMessage.status === 'sending') {
      // The user's own question (or retry): always show it and the thinking state.
      scrollToBottom(true)
    } else if (lastMessage.role === 'assistant') {
      const reply = replyRefs.current.get(lastMessage.id)
      if (nearBottomRef.current && reply) {
        // Start reading at the top of the answer, not its end.
        reply.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
      } else {
        // The reader scrolled up: don't move them; offer a way down instead.
        const frame = window.requestAnimationFrame(() => setShowJump(true))
        return () => window.cancelAnimationFrame(frame)
      }
    } else if (lastMessage.role === 'user' && lastMessage.status === 'failed' && nearBottomRef.current) {
      scrollToBottom(true)
    }
  }, [lastKey, lastMessage])

  const handleSend = useCallback((text: string) => send(text), [send])

  const handleRetry = useCallback(
    (id: string) => {
      retry(id)
      composerRef.current?.focus()
    },
    [retry],
  )

  const handleEdit = useCallback(
    (id: string) => {
      const text = edit(id)
      if (text !== null) composerRef.current?.setDraft(text)
    },
    [edit],
  )

  const handleReply = useCallback(() => composerRef.current?.focus(), [])

  const handlePrompt = useCallback(
    (prompt: string) => {
      if (send(prompt)) composerRef.current?.focus()
    },
    [send],
  )

  function clearConversation() {
    startNewConversation()
    setShowJump(false)
    setIsConfirmingNew(false)
    composerRef.current?.focus()
  }

  return (
    <div className="coach-page">
      <header className="coach-header">
        <div>
          <h1 className="dashboard-title">FitAI Coach</h1>
          <p className="coach-subtitle">Answers grounded in your logged weight, training and nutrition.</p>
        </div>
        {messages.length > 0 && (
          <button
            type="button"
            className="dashboard-secondary-button coach-new"
            onClick={() => (isPending ? setIsConfirmingNew(true) : clearConversation())}
          >
            <PlusIcon size={18} />
            New conversation
          </button>
        )}
      </header>

      {messages.length === 0 ? (
        <CoachEmptyState onPrompt={handlePrompt} disabled={isPending} />
      ) : (
        <section className="coach-conversation" aria-label="Conversation">
          {messages.map((message) =>
            message.role === 'user' ? (
              <CoachUserMessage key={message.id} message={message} onRetry={handleRetry} onEdit={handleEdit} />
            ) : (
              <div
                key={message.id}
                className="coach-reply-anchor"
                ref={(element) => {
                  if (element) replyRefs.current.set(message.id, element)
                  else replyRefs.current.delete(message.id)
                }}
              >
                <CoachReply message={message} onReply={handleReply} />
              </div>
            ),
          )}
          {isPending && <CoachThinking />}
        </section>
      )}

      <div className="coach-dock">
        {showJump && (
          <button
            type="button"
            className="coach-jump"
            onClick={() => {
              setShowJump(false)
              scrollToBottom(true)
            }}
          >
            <ArrowDownIcon size={16} />
            Jump to latest
          </button>
        )}
        <CoachComposer ref={composerRef} isBusy={isPending} onSend={handleSend} />
      </div>

      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      {isConfirmingNew && (
        <ConfirmDialog
          title="Start a new conversation?"
          message="FitAI is still answering. Its answer will be discarded. Your logged data is not affected."
          confirmLabel="Start new conversation"
          cancelLabel="Keep waiting"
          onConfirm={clearConversation}
          onCancel={() => setIsConfirmingNew(false)}
        />
      )}
    </div>
  )
}

export default AICoachPage
