import type { LoadUnit } from '../../services/workouts'
import {
  WORKOUT_LIMITS,
  exerciseErrorKey,
  setErrorKey,
  type DraftErrors,
  type WorkoutDraftExercise,
  type WorkoutDraftSet,
} from '../../features/workout/workoutDraft'
import {
  addSetButtonId,
  exerciseHeadingId,
  moveExerciseButtonId,
  setInputId,
} from '../../features/workout/workoutDomIds'

type ExerciseBlockProps = {
  entry: WorkoutDraftExercise
  index: number
  total: number
  errors: DraftErrors
  disabled: boolean
  onMove: (direction: -1 | 1) => void
  onRemove: () => void
  onAddSet: () => void
  onRemoveSet: (setKey: string) => void
  onUpdateSet: (
    setKey: string,
    patch: Partial<Pick<WorkoutDraftSet, 'reps' | 'load' | 'loadUnit'>>,
  ) => void
}

function ExerciseBlock({
  entry,
  index,
  total,
  errors,
  disabled,
  onMove,
  onRemove,
  onAddSet,
  onRemoveSet,
  onUpdateSet,
}: ExerciseBlockProps) {
  const name = entry.exercise.name
  const blockError = errors[exerciseErrorKey(entry.key)]
  const canAddSet = entry.sets.length < WORKOUT_LIMITS.maxSetsPerExercise

  return (
    <section
      className={blockError ? 'workout-exercise-block has-error' : 'workout-exercise-block'}
      aria-labelledby={exerciseHeadingId(entry.key)}
    >
      <div className="workout-exercise-header">
        <span className="workout-exercise-number" aria-hidden="true">
          {index + 1}
        </span>
        <h3 id={exerciseHeadingId(entry.key)} className="workout-exercise-name">
          {name}
          {entry.exercise.isCustom && <span className="workout-tag">Custom</span>}
        </h3>
        <div className="workout-exercise-controls">
          <button
            id={moveExerciseButtonId(entry.key, -1)}
            type="button"
            className="workout-icon-button"
            onClick={() => onMove(-1)}
            disabled={disabled || index === 0}
            aria-label={`Move ${name} up`}
          >
            ↑
          </button>
          <button
            id={moveExerciseButtonId(entry.key, 1)}
            type="button"
            className="workout-icon-button"
            onClick={() => onMove(1)}
            disabled={disabled || index === total - 1}
            aria-label={`Move ${name} down`}
          >
            ↓
          </button>
          <button
            type="button"
            className="workout-icon-button danger"
            onClick={onRemove}
            disabled={disabled}
            aria-label={`Remove ${name}`}
          >
            ×
          </button>
        </div>
      </div>

      {blockError && (
        <p className="workout-field-error" role="alert">
          {blockError}
        </p>
      )}

      <div className="workout-set-grid" role="group" aria-label={`${name} sets`}>
        <div className="workout-set-row workout-set-header" aria-hidden="true">
          <span>
            <span className="workout-set-label-long">Set</span>
            <span className="workout-set-label-short">#</span>
          </span>
          <span>Reps</span>
          <span>Load</span>
          <span>Unit</span>
          <span />
        </div>

        {entry.sets.map((set, setIndex) => {
          const setNumber = setIndex + 1
          const label = `${name}, set ${setNumber}`
          const repsError = errors[setErrorKey(set.key, 'reps')]
          const loadError = errors[setErrorKey(set.key, 'load')]
          const hasLoad = set.load.trim() !== ''
          const nextSet = entry.sets[setIndex + 1]
          const nextAfterLoad = nextSet
            ? setInputId(nextSet.key, 'reps')
            : addSetButtonId(entry.key)

          return (
            <div key={set.key} className="workout-set-entry">
              <div className="workout-set-row">
                <span className="workout-set-number">{setNumber}</span>
                <input
                  id={setInputId(set.key, 'reps')}
                  className="workout-set-input"
                  type="text"
                  inputMode="numeric"
                  enterKeyHint="next"
                  autoComplete="off"
                  maxLength={4}
                  value={set.reps}
                  placeholder="0"
                  onChange={(event) => onUpdateSet(set.key, { reps: event.target.value })}
                  disabled={disabled}
                  aria-label={`${label} reps`}
                  aria-invalid={repsError ? true : undefined}
                  aria-describedby={repsError ? `${setInputId(set.key, 'reps')}-error` : undefined}
                  data-enter-next={setInputId(set.key, 'load')}
                />
                <input
                  id={setInputId(set.key, 'load')}
                  className="workout-set-input"
                  type="text"
                  inputMode="decimal"
                  enterKeyHint="next"
                  autoComplete="off"
                  maxLength={7}
                  value={set.load}
                  placeholder="BW"
                  onChange={(event) => onUpdateSet(set.key, { load: event.target.value })}
                  disabled={disabled}
                  aria-label={`${label} load, leave empty for bodyweight`}
                  aria-invalid={loadError ? true : undefined}
                  aria-describedby={loadError ? `${setInputId(set.key, 'load')}-error` : undefined}
                  data-enter-next={nextAfterLoad}
                />
                <select
                  id={setInputId(set.key, 'unit')}
                  className="workout-set-unit"
                  value={set.loadUnit}
                  onChange={(event) =>
                    onUpdateSet(set.key, { loadUnit: event.target.value as LoadUnit })
                  }
                  // A unit only applies when there is an external load.
                  disabled={disabled || !hasLoad}
                  aria-label={`${label} load unit`}
                >
                  <option value="LB">lb</option>
                  <option value="KG">kg</option>
                </select>
                <button
                  type="button"
                  className="workout-icon-button"
                  onClick={() => onRemoveSet(set.key)}
                  disabled={disabled || entry.sets.length === 1}
                  aria-label={`Remove ${label}`}
                >
                  ×
                </button>
              </div>

              {(repsError || loadError) && (
                <div className="workout-set-errors">
                  {repsError && (
                    <p id={`${setInputId(set.key, 'reps')}-error`} className="workout-field-error">
                      Set {setNumber}: {repsError}
                    </p>
                  )}
                  {loadError && (
                    <p id={`${setInputId(set.key, 'load')}-error`} className="workout-field-error">
                      Set {setNumber}: {loadError}
                    </p>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <button
        id={addSetButtonId(entry.key)}
        type="button"
        className="workout-add-set"
        onClick={onAddSet}
        disabled={disabled || !canAddSet}
      >
        + Add set
      </button>
      {!canAddSet && (
        <p className="workout-hint">
          Up to {WORKOUT_LIMITS.maxSetsPerExercise} sets per exercise.
        </p>
      )}
    </section>
  )
}

export default ExerciseBlock
