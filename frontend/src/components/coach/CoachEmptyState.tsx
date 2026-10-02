import { STARTER_PROMPTS } from '../../features/coach/coachPrompts'
import FitAIMark from '../brand/FitAIMark'

type CoachEmptyStateProps = {
  onPrompt: (prompt: string) => void
  disabled: boolean
}

function CoachEmptyState({ onPrompt, disabled }: CoachEmptyStateProps) {
  return (
    <section className="coach-empty" aria-labelledby="coach-empty-title">
      <FitAIMark size={56} />
      <h2 id="coach-empty-title" className="coach-empty-title">
        Ask about your progress
      </h2>
      <p className="coach-empty-text">
        Ask about your weight, training and nutrition. FitAI reviews your logged data before it answers.
      </p>

      <ul className="coach-prompts" aria-label="Suggested questions">
        {STARTER_PROMPTS.map((prompt) => (
          <li key={prompt}>
            <button type="button" className="coach-prompt" onClick={() => onPrompt(prompt)} disabled={disabled}>
              {prompt}
            </button>
          </li>
        ))}
      </ul>

      <p className="coach-empty-note">Conversations stay in this browser tab and clear when you sign out.</p>
    </section>
  )
}

export default CoachEmptyState
