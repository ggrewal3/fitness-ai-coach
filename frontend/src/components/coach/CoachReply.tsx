import { memo } from 'react'
import FitAIMark from '../brand/FitAIMark'
import { CheckIcon } from '../ui/icons'
import type { CoachAssistantMessage } from '../../features/coach/coachTypes'
import CoachSources from './CoachSources'

type CoachReplyProps = {
  message: CoachAssistantMessage
  onReply: () => void
}

/** Paragraphs split on blank lines; single line breaks are kept by CSS. Text only, never HTML. */
function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean)
}

// One Coach answer: the answer, optional next steps, an optional question
// back to the user, and what data was reviewed.
function CoachReply({ message, onReply }: CoachReplyProps) {
  return (
    <article className="coach-reply" aria-label="FitAI Coach replied">
      <p className="coach-reply-label" aria-hidden="true">
        <FitAIMark size={22} />
        FitAI Coach
      </p>

      <div className="coach-answer">
        {paragraphs(message.answer).map((paragraph, index) => (
          <p key={index}>{paragraph}</p>
        ))}
      </div>

      {message.actionItems.length > 0 && (
        <section className="coach-actions" aria-label="What to do next">
          <h3 className="coach-section-label">What to do next</h3>
          <ul>
            {message.actionItems.map((item, index) => (
              <li key={index}>
                <CheckIcon size={16} />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {message.followUpQuestion && (
        <div className="coach-followup">
          <p>
            <span className="coach-followup-label">FitAI asks</span>
            <span className="coach-followup-question">{message.followUpQuestion}</span>
          </p>
          <button type="button" className="coach-link-button" onClick={onReply}>
            Reply
          </button>
        </div>
      )}

      <CoachSources sources={message.sources} />
    </article>
  )
}

export default memo(CoachReply)
