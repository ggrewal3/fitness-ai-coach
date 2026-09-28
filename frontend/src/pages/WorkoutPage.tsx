import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import WorkoutCard from '../components/workout/WorkoutCard'
import { ApiRequestError } from '../services/api'
import {
  formatDateLabel,
  getLocalDateString,
  shiftDateString,
} from '../services/nutrition'
import {
  TRAINING_TYPE_LABELS,
  fetchRecentWorkouts,
  fetchWorkoutsForDate,
  type WorkoutDetail,
  type WorkoutSummary,
} from '../services/workouts'
import { isValidDateString } from '../features/workout/workoutDraft'

const RECENT_WORKOUT_LIMIT = 7

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof ApiRequestError ? error.message : fallback
}

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`
}

function WorkoutPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const todayString = getLocalDateString(new Date())
  const dateParam = searchParams.get('date')
  const selectedDate = dateParam && isValidDateString(dateParam) ? dateParam : todayString
  const isToday = selectedDate === todayString
  const dateLabel = isToday ? 'Today' : formatDateLabel(selectedDate)

  const [dayWorkouts, setDayWorkouts] = useState<WorkoutDetail[]>([])
  const [loadedDate, setLoadedDate] = useState<string | null>(null)
  const [dayError, setDayError] = useState<string | null>(null)
  const [dayReloadToken, setDayReloadToken] = useState(0)

  const [recentWorkouts, setRecentWorkouts] = useState<WorkoutSummary[]>([])
  const [recentReloadToken, setRecentReloadToken] = useState(0)

  useEffect(() => {
    let isCurrent = true

    async function loadDay() {
      try {
        const workouts = await fetchWorkoutsForDate(selectedDate)

        if (isCurrent) {
          setDayWorkouts(workouts)
          setDayError(null)
          setLoadedDate(selectedDate)
        }
      } catch (error) {
        if (isCurrent) {
          setDayWorkouts([])
          setDayError(getErrorMessage(error, 'Unable to load workouts.'))
          setLoadedDate(selectedDate)
        }
      }
    }

    void loadDay()

    return () => {
      isCurrent = false
    }
  }, [selectedDate, dayReloadToken])

  useEffect(() => {
    let isCurrent = true

    async function loadRecent() {
      try {
        const workouts = await fetchRecentWorkouts(RECENT_WORKOUT_LIMIT)

        if (isCurrent) {
          setRecentWorkouts(workouts)
        }
      } catch {
        // Recent history is supplementary; the card is simply hidden on failure.
        if (isCurrent) {
          setRecentWorkouts([])
        }
      }
    }

    void loadRecent()

    return () => {
      isCurrent = false
    }
  }, [recentReloadToken])

  function selectDate(date: string) {
    setSearchParams({ date }, { replace: true })
  }

  function handleWorkoutDeleted() {
    setDayReloadToken((token) => token + 1)
    setRecentReloadToken((token) => token + 1)
  }

  const isLoadingDay = loadedDate !== selectedDate
  const totalMinutes = dayWorkouts.reduce((sum, workout) => sum + workout.durationMinutes, 0)
  const exerciseCount = dayWorkouts.reduce((sum, workout) => sum + workout.exercises.length, 0)
  const setCount = dayWorkouts.reduce(
    (sum, workout) =>
      sum + workout.exercises.reduce((setSum, entry) => setSum + entry.sets.length, 0),
    0,
  )
  const logWorkoutPath = `/workout/new?date=${selectedDate}`

  return (
    <div className="workout-page">
      <div className="nutrition-page-header">
        <h1>Workout</h1>

        <div className="nutrition-date-nav">
          <button
            type="button"
            className="nutrition-nav-button"
            onClick={() => selectDate(shiftDateString(selectedDate, -1))}
            aria-label="Previous day"
          >
            &lsaquo;
          </button>
          <button
            type="button"
            className="nutrition-date-label"
            onClick={() => selectDate(todayString)}
          >
            {dateLabel}
          </button>
          <button
            type="button"
            className="nutrition-nav-button"
            onClick={() => selectDate(shiftDateString(selectedDate, 1))}
            aria-label="Next day"
          >
            &rsaquo;
          </button>
        </div>
      </div>

      <div className="workout-layout">
        <aside className="workout-summary-card" aria-label="Daily workout summary">
          <p className="nutrition-eyebrow">{isToday ? 'Today' : dateLabel}</p>

          {isLoadingDay && <p className="nutrition-summary-status">Loading…</p>}

          {!isLoadingDay && !dayError && dayWorkouts.length > 0 && (
            <>
              <div className="nutrition-summary-hero">
                <span className="nutrition-summary-kcal">{totalMinutes}</span>
                <span className="nutrition-summary-kcal-unit">min</span>
              </div>
              <p className="nutrition-summary-count">
                {pluralize(dayWorkouts.length, 'workout')} logged
              </p>
              <div className="workout-summary-stats">
                <div className="nutrition-macro-tile">
                  <span className="nutrition-macro-label">Exercises</span>
                  <span className="nutrition-summary-macro-value">{exerciseCount}</span>
                </div>
                <div className="nutrition-macro-tile">
                  <span className="nutrition-macro-label">Sets</span>
                  <span className="nutrition-summary-macro-value">{setCount}</span>
                </div>
              </div>
            </>
          )}

          {!isLoadingDay && !dayError && dayWorkouts.length === 0 && (
            <div className="nutrition-summary-empty">
              <p className="nutrition-summary-empty-title">No workout logged</p>
              <p className="header-label">Log a workout to see it here.</p>
            </div>
          )}

          <Link to={logWorkoutPath} className="dashboard-primary-button">
            + Log workout
          </Link>
        </aside>

        <section className="workout-day" aria-label={`Workouts for ${dateLabel}`}>
          {isLoadingDay && <p className="nutrition-summary-status">Loading workouts…</p>}

          {!isLoadingDay && dayError && (
            <div className="workout-editor-card">
              <p className="form-error" role="alert">
                {dayError}
              </p>
              <button
                type="button"
                className="dashboard-secondary-button workout-inline-button"
                onClick={() => setDayReloadToken((token) => token + 1)}
              >
                Retry
              </button>
            </div>
          )}

          {!isLoadingDay && !dayError && dayWorkouts.length === 0 && (
            <div className="workout-day-empty">
              <p className="nutrition-summary-empty-title">
                No workouts on {isToday ? 'today' : dateLabel}
              </p>
              <p className="header-label">
                Log your training after your session: exercises, sets, reps and load.
              </p>
              <Link to={logWorkoutPath} className="dashboard-secondary-button workout-inline-button">
                + Log workout
              </Link>
            </div>
          )}

          {!isLoadingDay &&
            !dayError &&
            dayWorkouts.map((workout) => (
              <WorkoutCard key={workout.id} workout={workout} onDeleted={handleWorkoutDeleted} />
            ))}
        </section>

        {recentWorkouts.length > 0 && (
          <section className="workout-recent-card" aria-labelledby="workout-recent-heading">
            <h2 id="workout-recent-heading" className="nutrition-eyebrow">
              Recent workouts
            </h2>
            <ul className="workout-recent-list">
              {recentWorkouts.map((workout) => (
                <li key={workout.id}>
                  <button
                    type="button"
                    className="workout-recent-item"
                    onClick={() => selectDate(workout.workoutDate)}
                    aria-current={workout.workoutDate === selectedDate ? 'date' : undefined}
                  >
                    <span className="workout-recent-title">{workout.title}</span>
                    <span className="workout-recent-meta">
                      {formatDateLabel(workout.workoutDate)} ·{' '}
                      {TRAINING_TYPE_LABELS[workout.trainingType]} · {workout.durationMinutes} min
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}

export default WorkoutPage
