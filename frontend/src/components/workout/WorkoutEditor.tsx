import {
  useEffect,
  useId,
  useReducer,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import { useBlocker, useNavigate } from 'react-router-dom'
import { ApiRequestError } from '../../services/api'
import type { FindOrCreateExerciseResult } from '../../services/exercises'
import {
  TRAINING_TYPE_LABELS,
  TRAINING_TYPE_ORDER,
  type TrainingType,
  type WorkoutDetail,
} from '../../services/workouts'
import {
  WORKOUT_LIMITS,
  createDraftKey,
  exerciseErrorKey,
  isDraftEqual,
  mapServerErrors,
  setErrorKey,
  validateDraft,
  workoutDraftReducer,
  type DraftErrors,
  type WorkoutDraft,
  type WorkoutDraftExercise,
  type WorkoutDraftSessionField,
  type WorkoutDraftSet,
} from '../../features/workout/workoutDraft'
import {
  ADD_EXERCISE_BUTTON_ID,
  addSetButtonId,
  moveExerciseButtonId,
  setInputId,
} from '../../features/workout/workoutDomIds'
import ConfirmDialog from './ConfirmDialog'
import ExerciseBlock from './ExerciseBlock'
import ExercisePicker from './ExercisePicker'

type WorkoutEditorProps = {
  mode: 'create' | 'edit'
  initialDraft: WorkoutDraft
  /** Where Cancel goes (e.g. back to the Workout page for the original date). */
  returnTo: string
  onSave: (draft: WorkoutDraft) => Promise<WorkoutDetail>
}

type FocusRequest = { id: string; select?: boolean }

function omitKeys(errors: DraftErrors, keys: string[]): DraftErrors {
  if (!keys.some((key) => key in errors)) {
    return errors
  }

  const next = { ...errors }

  for (const key of keys) {
    delete next[key]
  }

  return next
}

function WorkoutEditor({ mode, initialDraft, returnTo, onSave }: WorkoutEditorProps) {
  const navigate = useNavigate()
  const fieldId = useId()
  const formRef = useRef<HTMLFormElement>(null)
  const messageRef = useRef<HTMLDivElement>(null)

  const [draft, dispatch] = useReducer(workoutDraftReducer, initialDraft)
  const [errors, setErrors] = useState<DraftErrors>({})
  const [formMessage, setFormMessage] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [savedPath, setSavedPath] = useState<string | null>(null)
  const [isPickerOpen, setIsPickerOpen] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null)
  const [errorFocusCount, setErrorFocusCount] = useState(0)

  const isDirty = savedPath === null && !isDraftEqual(draft, initialDraft)

  // In-app navigation away from unsaved changes asks for confirmation.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      isDirty &&
      `${currentLocation.pathname}${currentLocation.search}` !==
        `${nextLocation.pathname}${nextLocation.search}`,
  )

  // Reloading or closing the tab with unsaved changes gets the browser prompt.
  useEffect(() => {
    if (!isDirty) {
      return
    }

    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [isDirty])

  // After a successful save the draft is no longer "dirty", so this
  // navigation is not blocked.
  useEffect(() => {
    if (savedPath) {
      navigate(savedPath, { replace: true })
    }
  }, [savedPath, navigate])

  useEffect(() => {
    if (!focusRequest) {
      return
    }

    const element = document.getElementById(focusRequest.id)

    if (element) {
      element.focus()

      if (focusRequest.select && element instanceof HTMLInputElement) {
        element.select()
      }
    }
  }, [focusRequest])

  useEffect(() => {
    if (errorFocusCount === 0) {
      return
    }

    const firstInvalid = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')
    ;(firstInvalid ?? messageRef.current)?.focus()
  }, [errorFocusCount])

  const exerciseIdsInWorkout = new Set(draft.exercises.map((entry) => entry.exercise.id))
  const canAddExercise = draft.exercises.length < WORKOUT_LIMITS.maxExercises
  const disabled = isSaving

  function setField(field: WorkoutDraftSessionField, value: string) {
    dispatch({ type: 'setField', field, value })
    setErrors((current) => omitKeys(current, [field]))
  }

  function handleSelectExercise(result: FindOrCreateExerciseResult) {
    const exerciseKey = createDraftKey('exercise')
    const setKey = createDraftKey('set')
    const { exercise } = result

    dispatch({ type: 'addExercise', exercise, exerciseKey, setKey })
    setIsPickerOpen(false)
    setErrors((current) => omitKeys(current, ['exercises']))
    setFocusRequest({ id: setInputId(setKey, 'reps') })
    setAnnouncement(
      result.created
        ? `Created custom exercise ${exercise.name} and added it.`
        : `${exercise.name} added.`,
    )
  }

  function handleClosePicker(restoreFocus: boolean) {
    setIsPickerOpen(false)

    if (restoreFocus) {
      setFocusRequest({ id: ADD_EXERCISE_BUTTON_ID })
    }
  }

  function handleRemoveExercise(entry: WorkoutDraftExercise) {
    dispatch({ type: 'removeExercise', exerciseKey: entry.key })
    setErrors((current) =>
      omitKeys(current, [
        exerciseErrorKey(entry.key),
        ...entry.sets.flatMap((set) => [
          setErrorKey(set.key, 'reps'),
          setErrorKey(set.key, 'load'),
        ]),
      ]),
    )
    setFocusRequest({ id: ADD_EXERCISE_BUTTON_ID })
    setAnnouncement(`${entry.exercise.name} removed.`)
  }

  function handleMoveExercise(entry: WorkoutDraftExercise, index: number, direction: -1 | 1) {
    const newIndex = index + direction

    dispatch({ type: 'moveExercise', exerciseKey: entry.key, direction })

    // Keep focus on a usable control: at either end the pressed button
    // becomes disabled, so move focus to the opposite one.
    const atEdge = newIndex === 0 || newIndex === draft.exercises.length - 1
    setFocusRequest({
      id: moveExerciseButtonId(entry.key, atEdge ? (-direction as -1 | 1) : direction),
    })
    setAnnouncement(`${entry.exercise.name} moved to position ${newIndex + 1}.`)
  }

  function handleAddSet(entry: WorkoutDraftExercise) {
    const setKey = createDraftKey('set')

    dispatch({ type: 'addSet', exerciseKey: entry.key, setKey })
    setErrors((current) => omitKeys(current, [exerciseErrorKey(entry.key)]))
    // The new set copies the previous one; select it so typing replaces it.
    setFocusRequest({ id: setInputId(setKey, 'reps'), select: true })
    setAnnouncement(`${entry.exercise.name} set ${entry.sets.length + 1} added.`)
  }

  function handleRemoveSet(entry: WorkoutDraftExercise, setKey: string) {
    const index = entry.sets.findIndex((set) => set.key === setKey)
    const neighbour = entry.sets[index - 1] ?? entry.sets[index + 1]

    dispatch({ type: 'removeSet', exerciseKey: entry.key, setKey })
    setErrors((current) =>
      omitKeys(current, [setErrorKey(setKey, 'reps'), setErrorKey(setKey, 'load')]),
    )
    setFocusRequest({
      id: neighbour ? setInputId(neighbour.key, 'reps') : addSetButtonId(entry.key),
    })
    setAnnouncement(`${entry.exercise.name} set ${index + 1} removed.`)
  }

  function handleUpdateSet(
    entry: WorkoutDraftExercise,
    setKey: string,
    patch: Partial<Pick<WorkoutDraftSet, 'reps' | 'load' | 'loadUnit'>>,
  ) {
    dispatch({ type: 'updateSet', exerciseKey: entry.key, setKey, patch })

    const cleared: string[] = []
    if ('reps' in patch) cleared.push(setErrorKey(setKey, 'reps'))
    if ('load' in patch || 'loadUnit' in patch) cleared.push(setErrorKey(setKey, 'load'))
    setErrors((current) => omitKeys(current, cleared))
  }

  // Enter never submits the form implicitly; inside set rows it moves to the
  // next field (reps -> load -> next set's reps / Add set).
  function handleFormKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    const target = event.target

    if (event.key !== 'Enter' || !(target instanceof HTMLInputElement)) {
      return
    }

    event.preventDefault()

    const nextId = target.dataset.enterNext

    if (nextId) {
      document.getElementById(nextId)?.focus()
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (isSaving) {
      return
    }

    const validationErrors = validateDraft(draft)

    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors)
      setFormMessage('Fix the highlighted fields before saving.')
      setErrorFocusCount((count) => count + 1)
      return
    }

    setErrors({})
    setFormMessage(null)
    setIsSaving(true)

    try {
      const saved = await onSave(draft)
      setSavedPath(`/workout?date=${saved.workoutDate}`)
    } catch (error) {
      if (error instanceof ApiRequestError && error.errors.length > 0) {
        const mapped = mapServerErrors(draft, error.errors)
        setErrors(mapped.errors)
        setFormMessage(
          mapped.unmatched.length > 0
            ? mapped.unmatched.join(' ')
            : 'Fix the highlighted fields before saving.',
        )
      } else if (error instanceof ApiRequestError && error.status === 404) {
        setFormMessage('This workout no longer exists. It may have been deleted.')
      } else if (error instanceof ApiRequestError && error.status > 0) {
        setFormMessage(error.message)
      } else {
        setFormMessage('Could not save the workout. Check your connection and try again.')
      }

      setErrorFocusCount((count) => count + 1)
    } finally {
      setIsSaving(false)
    }
  }

  const fieldIds = {
    title: `${fieldId}-title`,
    workoutDate: `${fieldId}-date`,
    trainingType: `${fieldId}-type`,
    durationMinutes: `${fieldId}-duration`,
    notes: `${fieldId}-notes`,
  }

  function describedBy(field: keyof typeof fieldIds) {
    return errors[field] ? `${fieldIds[field]}-error` : undefined
  }

  function fieldError(field: keyof typeof fieldIds) {
    return errors[field] ? (
      <p id={`${fieldIds[field]}-error`} className="workout-field-error">
        {errors[field]}
      </p>
    ) : null
  }

  return (
    <>
      <form
        ref={formRef}
        className="workout-editor"
        onSubmit={handleSubmit}
        onKeyDown={handleFormKeyDown}
        noValidate
      >
        <div className="workout-editor-header">
          <h1>{mode === 'create' ? 'Log workout' : 'Edit workout'}</h1>
        </div>

        {formMessage && (
          <div ref={messageRef} className="workout-form-message" role="alert" tabIndex={-1}>
            {formMessage}
          </div>
        )}

        <section className="workout-editor-card" aria-labelledby={`${fieldId}-details`}>
          <h2 id={`${fieldId}-details`} className="nutrition-eyebrow">
            Details
          </h2>

          <div className="workout-field">
            <label htmlFor={fieldIds.title}>Title</label>
            <input
              id={fieldIds.title}
              type="text"
              value={draft.title}
              placeholder="e.g. Push Day"
              maxLength={WORKOUT_LIMITS.maxTitleLength}
              autoComplete="off"
              onChange={(event) => setField('title', event.target.value)}
              disabled={disabled}
              aria-invalid={errors.title ? true : undefined}
              aria-describedby={describedBy('title')}
            />
            {fieldError('title')}
          </div>

          <div className="workout-field-row">
            <div className="workout-field workout-field-date">
              <label htmlFor={fieldIds.workoutDate}>Date</label>
              <input
                id={fieldIds.workoutDate}
                type="date"
                value={draft.workoutDate}
                onChange={(event) => setField('workoutDate', event.target.value)}
                disabled={disabled}
                aria-invalid={errors.workoutDate ? true : undefined}
                aria-describedby={describedBy('workoutDate')}
              />
              {fieldError('workoutDate')}
            </div>

            <div className="workout-field">
              <label htmlFor={fieldIds.trainingType}>Type</label>
              <select
                id={fieldIds.trainingType}
                value={draft.trainingType}
                onChange={(event) => {
                  dispatch({ type: 'setTrainingType', value: event.target.value as TrainingType })
                  setErrors((current) => omitKeys(current, ['trainingType']))
                }}
                disabled={disabled}
                aria-invalid={errors.trainingType ? true : undefined}
                aria-describedby={describedBy('trainingType')}
              >
                {TRAINING_TYPE_ORDER.map((type) => (
                  <option key={type} value={type}>
                    {TRAINING_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
              {fieldError('trainingType')}
            </div>

            <div className="workout-field">
              <label htmlFor={fieldIds.durationMinutes}>Duration</label>
              <div className="workout-input-suffix">
                <input
                  id={fieldIds.durationMinutes}
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={4}
                  value={draft.durationMinutes}
                  placeholder="60"
                  onChange={(event) => setField('durationMinutes', event.target.value)}
                  disabled={disabled}
                  aria-invalid={errors.durationMinutes ? true : undefined}
                  aria-describedby={describedBy('durationMinutes')}
                />
                <span aria-hidden="true">min</span>
              </div>
              {fieldError('durationMinutes')}
            </div>
          </div>
        </section>

        <section className="workout-editor-exercises" aria-labelledby={`${fieldId}-exercises`}>
          <div className="workout-section-heading">
            <h2 id={`${fieldId}-exercises`} className="nutrition-eyebrow">
              Exercises
            </h2>
            {draft.exercises.length > 0 && (
              <span className="workout-hint">
                {draft.exercises.length} of {WORKOUT_LIMITS.maxExercises}
              </span>
            )}
          </div>

          {errors.exercises && (
            <p className="workout-field-error" role="alert">
              {errors.exercises}
            </p>
          )}

          {draft.exercises.length === 0 && !isPickerOpen && (
            <p className="workout-empty-exercises">
              No exercises yet. Add exercises and sets, or save without them for a
              session-only workout.
            </p>
          )}

          {draft.exercises.map((entry, index) => (
            <ExerciseBlock
              key={entry.key}
              entry={entry}
              index={index}
              total={draft.exercises.length}
              errors={errors}
              disabled={disabled}
              onMove={(direction) => handleMoveExercise(entry, index, direction)}
              onRemove={() => handleRemoveExercise(entry)}
              onAddSet={() => handleAddSet(entry)}
              onRemoveSet={(setKey) => handleRemoveSet(entry, setKey)}
              onUpdateSet={(setKey, patch) => handleUpdateSet(entry, setKey, patch)}
            />
          ))}

          {isPickerOpen ? (
            <ExercisePicker
              exerciseIdsInWorkout={exerciseIdsInWorkout}
              onSelect={handleSelectExercise}
              onClose={handleClosePicker}
            />
          ) : (
            <button
              id={ADD_EXERCISE_BUTTON_ID}
              type="button"
              className="workout-add-exercise"
              onClick={() => setIsPickerOpen(true)}
              disabled={disabled || !canAddExercise}
            >
              + Add exercise
            </button>
          )}
          {!canAddExercise && (
            <p className="workout-hint">
              Up to {WORKOUT_LIMITS.maxExercises} exercises per workout.
            </p>
          )}
        </section>

        <section className="workout-editor-card">
          <div className="workout-field">
            <label htmlFor={fieldIds.notes}>
              Notes <span className="workout-optional">(optional)</span>
            </label>
            <textarea
              id={fieldIds.notes}
              rows={3}
              value={draft.notes}
              maxLength={WORKOUT_LIMITS.maxNotesLength}
              placeholder="How did it feel?"
              onChange={(event) => setField('notes', event.target.value)}
              disabled={disabled}
              aria-invalid={errors.notes ? true : undefined}
              aria-describedby={describedBy('notes')}
            />
            {fieldError('notes')}
          </div>
        </section>

        <div className="workout-editor-actions">
          <button
            type="button"
            className="dashboard-secondary-button"
            onClick={() => navigate(returnTo)}
            disabled={isSaving}
          >
            Cancel
          </button>
          <button type="submit" className="dashboard-primary-button" disabled={isSaving}>
            {isSaving ? 'Saving…' : 'Save workout'}
          </button>
        </div>

        <p className="workout-sr-only" aria-live="polite">
          {announcement}
        </p>
      </form>

      {blocker.state === 'blocked' && (
        <ConfirmDialog
          title="Discard changes?"
          message="You have unsaved changes to this workout. If you leave now, they will be lost."
          confirmLabel="Discard changes"
          cancelLabel="Keep editing"
          onConfirm={() => blocker.proceed()}
          onCancel={() => blocker.reset()}
        />
      )}
    </>
  )
}

export default WorkoutEditor
