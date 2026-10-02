import { useId, useImperativeHandle, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent, type Ref } from 'react'
import { COACH_LIMITS } from '../../features/coach/coachTypes'
import { SendIcon } from '../ui/icons'

export type CoachComposerHandle = {
  focus: () => void
  /** Replaces the draft (e.g. Edit of a failed question) and focuses it. */
  setDraft: (text: string) => void
}

type CoachComposerProps = {
  ref?: Ref<CoachComposerHandle>
  /** True while a request is in flight: drafting stays possible, sending does not. */
  isBusy: boolean
  /** Returns true when the message was accepted (the draft is then cleared). */
  onSend: (text: string) => boolean
}

const COUNTER_FROM = 1800
const MAX_HEIGHT_PX = 200

// Auto-growing message box. Enter sends, Shift+Enter adds a line, and Enter
// during IME composition is left to the input method.
function CoachComposer({ ref, isBusy, onSend }: CoachComposerProps) {
  const [draft, setDraft] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const hintId = useId()
  const counterId = useId()
  const canSend = !isBusy && draft.trim().length > 0

  useImperativeHandle(ref, () => ({
    focus: () => textareaRef.current?.focus(),
    setDraft: (text: string) => {
      setDraft(text.slice(0, COACH_LIMITS.maxMessageChars))
      textareaRef.current?.focus()
    },
  }))

  // Grow with the content up to MAX_HEIGHT_PX, then scroll inside.
  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, MAX_HEIGHT_PX)}px`
  }, [draft])

  function submit() {
    if (canSend && onSend(draft)) {
      setDraft('')
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || event.keyCode === 229) {
      return
    }

    event.preventDefault()
    submit()
  }

  const showCounter = draft.length >= COUNTER_FROM

  return (
    <form
      className="coach-composer"
      onSubmit={(event: FormEvent) => {
        event.preventDefault()
        submit()
      }}
    >
      <label htmlFor={`${hintId}-input`} className="sr-only">
        Ask FitAI Coach
      </label>
      <div className="coach-composer-box">
        <textarea
          id={`${hintId}-input`}
          ref={textareaRef}
          className="coach-composer-input"
          rows={1}
          maxLength={COACH_LIMITS.maxMessageChars}
          placeholder="Ask about your weight, training or nutrition…"
          value={draft}
          // maxLength covers typing and paste; this also covers programmatic input.
          onChange={(event) => setDraft(event.target.value.slice(0, COACH_LIMITS.maxMessageChars))}
          onKeyDown={handleKeyDown}
          aria-describedby={showCounter ? `${hintId} ${counterId}` : hintId}
        />
        <button type="submit" className="coach-send" disabled={!canSend} aria-label="Send message">
          <SendIcon size={18} />
        </button>
      </div>
      <div className="coach-composer-meta">
        <span id={hintId}>{isBusy ? 'FitAI is answering…' : 'Enter to send · Shift+Enter for a new line'}</span>
        {showCounter && (
          <span id={counterId} className={draft.length >= COACH_LIMITS.maxMessageChars ? 'coach-counter full' : 'coach-counter'}>
            {draft.length.toLocaleString()} / {COACH_LIMITS.maxMessageChars.toLocaleString()}
          </span>
        )}
      </div>
    </form>
  )
}

export default CoachComposer
