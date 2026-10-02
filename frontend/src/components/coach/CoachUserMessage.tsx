import { memo, useEffect, useState } from 'react'
import { AlertIcon } from '../ui/icons'
import type { CoachUserMessage as CoachUserMessageType } from '../../features/coach/coachTypes'

type CoachUserMessageProps = {
  message: CoachUserMessageType
  onRetry: (id: string) => void
  onEdit: (id: string) => void
}

/** Seconds until Retry is allowed again (429 Retry-After), ticking once a second. */
function useSecondsUntil(timestamp: number | null): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!timestamp || timestamp <= Date.now()) return

    const timer = window.setInterval(() => {
      setNow(Date.now())
      if (Date.now() >= timestamp) window.clearInterval(timer)
    }, 1000)

    return () => window.clearInterval(timer)
  }, [timestamp])

  return timestamp ? Math.max(0, Math.ceil((timestamp - now) / 1000)) : 0
}

type FailedActionsProps = {
  message: CoachUserMessageType & { error: NonNullable<CoachUserMessageType['error']> }
  onRetry: (id: string) => void
  onEdit: (id: string) => void
}

// Keyed by the retry deadline, so each failure starts with a fresh clock.
function FailedActions({ message, onRetry, onEdit }: FailedActionsProps) {
  const wait = useSecondsUntil(message.error.retryAvailableAt)

  return (
    <div className="coach-failed">
      <p className="coach-failed-message">
        <AlertIcon size={16} />
        <span>
          {message.error.message}
          {wait > 0 && ` You can try again in ${wait} second${wait === 1 ? '' : 's'}.`}
        </span>
      </p>
      <div className="coach-failed-actions">
        <button type="button" className="coach-link-button" onClick={() => onRetry(message.id)} disabled={wait > 0}>
          {wait > 0 ? `Retry in ${wait}s` : 'Retry'}
        </button>
        <button type="button" className="coach-link-button" onClick={() => onEdit(message.id)}>
          Edit
        </button>
      </div>
    </div>
  )
}

// The user's own message. A failed one stays visible with its error, Retry
// (same question, same history) and Edit (back into the composer).
function CoachUserMessage({ message, onRetry, onEdit }: CoachUserMessageProps) {
  const failed = message.status === 'failed' && message.error !== null

  return (
    <article className={failed ? 'coach-user failed' : 'coach-user'} aria-label="You said">
      <p className="coach-user-text">{message.content}</p>

      {failed && message.error && (
        <FailedActions
          key={`${message.error.kind}-${message.error.retryAvailableAt ?? 'now'}`}
          message={{ ...message, error: message.error }}
          onRetry={onRetry}
          onEdit={onEdit}
        />
      )}
    </article>
  )
}

export default memo(CoachUserMessage)
