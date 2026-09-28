import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiRequestError } from '../../services/api'
import {
  TRAINING_TYPE_LABELS,
  formatWorkoutSet,
  removeWorkout,
  type WorkoutDetail,
} from '../../services/workouts'

type WorkoutCardProps = {
  workout: WorkoutDetail
  onDeleted: () => void | Promise<void>
}

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`
}

function WorkoutCard({ workout, onDeleted }: WorkoutCardProps) {
  const [isConfirming, setIsConfirming] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const deleteRef = useRef<HTMLButtonElement>(null)
  const wasConfirmingRef = useRef(false)

  // Focus the safe choice when confirmation opens; return to Delete when it closes.
  useEffect(() => {
    if (isConfirming) {
      cancelRef.current?.focus()
    } else if (wasConfirmingRef.current) {
      deleteRef.current?.focus()
    }

    wasConfirmingRef.current = isConfirming
  }, [isConfirming])

  const setCount = workout.exercises.reduce((sum, entry) => sum + entry.sets.length, 0)
  const meta = [
    TRAINING_TYPE_LABELS[workout.trainingType],
    `${workout.durationMinutes} min`,
    ...(workout.exercises.length > 0
      ? [pluralize(workout.exercises.length, 'exercise'), pluralize(setCount, 'set')]
      : []),
  ].join(' · ')

  async function handleDelete() {
    setIsDeleting(true)
    setDeleteError(null)

    try {
      await removeWorkout(workout.id)
      await onDeleted()
    } catch (error) {
      setDeleteError(
        error instanceof ApiRequestError ? error.message : 'Unable to delete the workout.',
      )
      setIsDeleting(false)
      setIsConfirming(false)
    }
  }

  const titleId = `workout-card-${workout.id}-title`

  return (
    <article className="workout-card" aria-labelledby={titleId}>
      <div className="workout-card-header">
        <div className="workout-card-heading">
          <h2 id={titleId}>{workout.title}</h2>
          <p className="workout-card-meta">{meta}</p>
        </div>

        {!isConfirming && (
          <div className="workout-card-actions">
            <Link
              to={`/workout/${workout.id}/edit`}
              className="nutrition-edit-button workout-card-action"
              aria-label={`Edit ${workout.title}`}
            >
              Edit
            </Link>
            <button
              ref={deleteRef}
              type="button"
              className="nutrition-delete-button workout-card-action"
              onClick={() => setIsConfirming(true)}
              aria-label={`Delete ${workout.title}`}
            >
              Delete
            </button>
          </div>
        )}
      </div>

      {isConfirming && (
        <div className="workout-delete-confirm" role="group" aria-label="Confirm delete">
          <p>Delete this workout? This can’t be undone.</p>
          <div className="workout-delete-confirm-actions">
            <button
              ref={cancelRef}
              type="button"
              className="dashboard-secondary-button"
              onClick={() => setIsConfirming(false)}
              disabled={isDeleting}
            >
              Cancel
            </button>
            <button
              type="button"
              className="workout-danger-button"
              onClick={() => void handleDelete()}
              disabled={isDeleting}
            >
              {isDeleting ? 'Deleting…' : 'Delete workout'}
            </button>
          </div>
        </div>
      )}

      {deleteError && (
        <p className="form-error" role="alert">
          {deleteError}
        </p>
      )}

      {workout.notes && <p className="workout-card-notes">{workout.notes}</p>}

      {workout.exercises.length > 0 && (
        <ol className="workout-card-exercises">
          {workout.exercises.map((entry) => (
            <li key={entry.id} className="workout-card-exercise">
              <p className="workout-card-exercise-name">
                {entry.exercise.name}
                {entry.exercise.isCustom && <span className="workout-tag">Custom</span>}
              </p>
              <p className="workout-card-sets">
                {entry.sets.map((set) => formatWorkoutSet(set)).join(' · ')}
              </p>
            </li>
          ))}
        </ol>
      )}
    </article>
  )
}

export default WorkoutCard
