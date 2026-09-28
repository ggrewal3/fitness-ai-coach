import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { ApiRequestError } from '../../services/api'
import {
  findOrCreateExercise,
  searchExercises,
  type Exercise,
  type FindOrCreateExerciseResult,
} from '../../services/exercises'
import {
  getExerciseNameError,
  toExerciseDisplayName,
  toExerciseNormalizedName,
} from '../../features/workout/exerciseName'

const SEARCH_LIMIT = 8
const SEARCH_DEBOUNCE_MS = 200

type SearchStatus = 'idle' | 'loading' | 'ready' | 'error'

type PickerOption =
  | { kind: 'exercise'; exercise: Exercise }
  | { kind: 'create'; name: string }

type ExercisePickerProps = {
  /** Exercise ids already in the workout; still selectable (duplicates are allowed). */
  exerciseIdsInWorkout: ReadonlySet<number>
  onSelect: (result: FindOrCreateExerciseResult) => void
  /** restoreFocus is false when the picker closed because focus moved elsewhere. */
  onClose: (restoreFocus: boolean) => void
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiRequestError) {
    return error.errors[0]?.message ?? error.message
  }

  return fallback
}

function ExercisePicker({ exerciseIdsInWorkout, onSelect, onClose }: ExercisePickerProps) {
  const listboxId = useId()
  const hintId = useId()
  const inputRef = useRef<HTMLInputElement>(null)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Exercise[]>([])
  const [status, setStatus] = useState<SearchStatus>('idle')
  const [activeIndex, setActiveIndex] = useState(0)
  const [retryToken, setRetryToken] = useState(0)
  const [isCreating, setIsCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Debounced search; an in-flight request is aborted when the query changes,
  // so a stale response can never replace newer results.
  useEffect(() => {
    const search = query.trim()

    if (!search) {
      return
    }

    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      try {
        const exercises = await searchExercises(search, SEARCH_LIMIT, controller.signal)
        setResults(exercises)
        setStatus('ready')
        setActiveIndex(0)
      } catch (error) {
        if (controller.signal.aborted) {
          return
        }

        console.error('Exercise search failed:', error instanceof Error ? error.message : error)
        setResults([])
        setStatus('error')
        setActiveIndex(0)
      }
    }, SEARCH_DEBOUNCE_MS)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [query, retryToken])

  const displayName = toExerciseDisplayName(query)
  const normalizedQuery = toExerciseNormalizedName(query)
  const nameError = displayName ? getExerciseNameError(displayName) : null
  const hasExactMatch = results.some(
    (exercise) => toExerciseNormalizedName(exercise.name) === normalizedQuery,
  )
  const canOfferCreate =
    displayName !== '' &&
    (status === 'ready' || status === 'error') &&
    !hasExactMatch &&
    nameError === null

  const options: PickerOption[] = [
    ...(status === 'ready' ? results : []).map(
      (exercise): PickerOption => ({ kind: 'exercise', exercise }),
    ),
    ...(canOfferCreate ? [{ kind: 'create', name: displayName } as PickerOption] : []),
  ]
  const isListOpen = displayName !== '' && (status !== 'idle' || options.length > 0)
  const safeActiveIndex = Math.min(activeIndex, Math.max(options.length - 1, 0))
  const optionId = (index: number) => `${listboxId}-option-${index}`

  function handleQueryChange(value: string) {
    setQuery(value)
    setActiveIndex(0)
    setCreateError(null)
    setStatus(value.trim() ? 'loading' : 'idle')

    if (!value.trim()) {
      setResults([])
    }
  }

  async function chooseOption(option: PickerOption) {
    if (option.kind === 'exercise') {
      onSelect({ exercise: option.exercise, created: false })
      return
    }

    setIsCreating(true)
    setCreateError(null)

    try {
      const result = await findOrCreateExercise(option.name)
      onSelect(result)
    } catch (error) {
      setCreateError(getErrorMessage(error, 'Could not create the exercise. Try again.'))
      setIsCreating(false)
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      // Never let Enter submit the surrounding workout form.
      event.preventDefault()
      event.stopPropagation()

      const option = options[safeActiveIndex]

      if (option && !isCreating) {
        void chooseOption(option)
      }

      return
    }

    if (options.length === 0) {
      return
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((safeActiveIndex + 1) % options.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((safeActiveIndex - 1 + options.length) % options.length)
    }
  }

  return (
    <div
      className="exercise-picker"
      // Escape closes the picker from anywhere inside it (input, Retry, Cancel).
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          onClose(true)
        }
      }}
      onBlur={(event) => {
        // Close when focus leaves the picker (Tab or clicking elsewhere).
        if (!isCreating && !event.currentTarget.contains(event.relatedTarget as Node | null)) {
          onClose(false)
        }
      }}
    >
      <label className="exercise-picker-label" htmlFor={`${listboxId}-input`}>
        Add exercise
      </label>
      <div className="exercise-picker-field">
        <input
          ref={inputRef}
          id={`${listboxId}-input`}
          type="text"
          role="combobox"
          autoComplete="off"
          autoCapitalize="words"
          spellCheck={false}
          enterKeyHint="done"
          placeholder="Search exercises, e.g. bench"
          value={query}
          onChange={(event) => handleQueryChange(event.target.value)}
          onKeyDown={handleKeyDown}
          aria-autocomplete="list"
          aria-expanded={isListOpen}
          aria-controls={listboxId}
          aria-activedescendant={
            isListOpen && options.length > 0 ? optionId(safeActiveIndex) : undefined
          }
          aria-describedby={hintId}
          maxLength={60}
          // readOnly (not disabled) keeps focus in the field while creating.
          readOnly={isCreating}
          aria-busy={isCreating}
        />
        <button type="button" className="exercise-picker-cancel" onClick={() => onClose(true)}>
          Cancel
        </button>
      </div>

      <p id={hintId} className="exercise-picker-hint" aria-live="polite">
        {!displayName && 'Type to search built-in and your custom exercises.'}
        {displayName && status === 'loading' && 'Searching…'}
        {displayName && status === 'ready' && results.length === 0 && `No exercises match “${displayName}”.`}
        {displayName && status === 'error' && 'Couldn’t search exercises.'}
        {displayName && nameError && status !== 'loading' && !hasExactMatch && ` ${nameError}`}
        {isCreating && ' Creating exercise…'}
      </p>

      {status === 'error' && (
        <button
          type="button"
          className="exercise-picker-retry"
          onClick={() => {
            setStatus('loading')
            setRetryToken((token) => token + 1)
            inputRef.current?.focus()
          }}
        >
          Retry search
        </button>
      )}

      {createError && (
        <p className="form-error" role="alert">
          {createError}
        </p>
      )}

      <ul
        id={listboxId}
        role="listbox"
        aria-label="Exercise suggestions"
        className="exercise-picker-list"
        hidden={!isListOpen || options.length === 0}
      >
        {options.map((option, index) => {
          const isActive = index === safeActiveIndex

          return (
            <li
              key={option.kind === 'exercise' ? `exercise-${option.exercise.id}` : 'create'}
              id={optionId(index)}
              role="option"
              aria-selected={isActive}
              className={
                isActive ? 'exercise-picker-option active' : 'exercise-picker-option'
              }
              // Keep focus in the input so blur does not close the picker first.
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => {
                if (!isCreating) {
                  void chooseOption(option)
                }
              }}
            >
              {option.kind === 'exercise' ? (
                <>
                  <span className="exercise-picker-option-name">{option.exercise.name}</span>
                  {option.exercise.isCustom && <span className="workout-tag">Custom</span>}
                  {exerciseIdsInWorkout.has(option.exercise.id) && (
                    <span className="workout-tag muted">In workout</span>
                  )}
                </>
              ) : (
                <span className="exercise-picker-create">
                  + Create “{option.name}”
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export default ExercisePicker
