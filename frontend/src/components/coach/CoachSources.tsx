import { describeSource, formatSourcePeriod, sourceLabel } from '../../features/coach/coachSources'
import type { CoachSource } from '../../services/api'

type CoachSourcesProps = {
  sources: CoachSource[]
}

// What FitAI reviewed for this answer: the public categories and periods the
// server derived from the data it actually read. Renders nothing for [].
function CoachSources({ sources }: CoachSourcesProps) {
  if (sources.length === 0) {
    return null
  }

  return (
    <div className="coach-sources">
      <span className="coach-sources-label" aria-hidden="true">
        Reviewed
      </span>
      <ul className="coach-source-list" aria-label="Data FitAI reviewed for this answer">
        {sources.map((source) => {
          const period = formatSourcePeriod(source)

          return (
            <li key={source.type} className="coach-source" aria-label={describeSource(source)}>
              <span aria-hidden="true">{sourceLabel(source.type)}</span>
              {period && (
                <span className="coach-source-period" aria-hidden="true">
                  {period}
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export default CoachSources
