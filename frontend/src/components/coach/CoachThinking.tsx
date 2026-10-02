import { useEffect, useState } from 'react'
import FitAIMark from '../brand/FitAIMark'

const SLOW_AFTER_MS = 8000

// Shown while a request is in flight. Truthful about what is happening (the
// coach is checking the user's data) without implying visible reasoning.
function CoachThinking() {
  const [isSlow, setIsSlow] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setIsSlow(true), SLOW_AFTER_MS)
    return () => window.clearTimeout(timer)
  }, [])

  return (
    <div className="coach-thinking">
      <FitAIMark size={22} />
      <div>
        <p className="coach-thinking-text">
          FitAI is reviewing your data
          <span className="coach-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        </p>
        {isSlow && <p className="coach-thinking-hint">This can take up to half a minute.</p>}
      </div>
    </div>
  )
}

export default CoachThinking
