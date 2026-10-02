// The single editable representation of a workout in the frontend.
//
// Manual entry changes it only through workoutDraftReducer. Any future source
// of a workout (for example a later quick-log feature) should produce this
// same WorkoutDraft shape and hand it to the same editor; there is no
// source-specific editor state.
import type { ApiValidationError } from "../../services/api"
import type { Exercise } from "../../services/exercises"
import type {
  CreateWorkoutInput,
  LoadUnit,
  TrainingType,
  UpdateWorkoutInput,
  WorkoutDetail,
  WorkoutExerciseInput,
} from "../../services/workouts"

// Mirrors backend/src/modules/workouts/workout.schemas.ts.
export const WORKOUT_LIMITS = {
  maxTitleLength: 100,
  maxNotesLength: 2000,
  maxDurationMinutes: 1440,
  maxExercises: 30,
  maxSetsPerExercise: 20,
  maxReps: 1000,
  maxLoad: 2000,
} as const

export type WorkoutDraftSet = {
  /** Client-only stable id for React keys, focus and error mapping. Never sent. */
  key: string
  /** Raw input text; converted only when saving. */
  reps: string
  /** Raw input text; empty means no external load (bodyweight). */
  load: string
  /** Kept even when load is empty so clearing and re-entering a load keeps its unit. */
  loadUnit: LoadUnit
}

export type WorkoutDraftExercise = {
  key: string
  exercise: Exercise
  sets: WorkoutDraftSet[]
}

export type WorkoutDraft = {
  /**
   * Unit for the first set of a newly added exercise: the user's
   * workoutLoadUnit preference, captured when the draft is created so a later
   * preference change never alters an open editor (ADR-007). Never sent.
   */
  newExerciseLoadUnit: LoadUnit
  title: string
  workoutDate: string
  trainingType: TrainingType
  durationMinutes: string
  notes: string
  exercises: WorkoutDraftExercise[]
}

export type WorkoutDraftSessionField =
  | "title"
  | "workoutDate"
  | "durationMinutes"
  | "notes"

export type WorkoutDraftAction =
  | { type: "setField"; field: WorkoutDraftSessionField; value: string }
  | { type: "setTrainingType"; value: TrainingType }
  | { type: "addExercise"; exercise: Exercise; exerciseKey: string; setKey: string }
  | { type: "removeExercise"; exerciseKey: string }
  | { type: "moveExercise"; exerciseKey: string; direction: -1 | 1 }
  | { type: "addSet"; exerciseKey: string; setKey: string }
  | { type: "removeSet"; exerciseKey: string; setKey: string }
  | {
      type: "updateSet"
      exerciseKey: string
      setKey: string
      patch: Partial<Pick<WorkoutDraftSet, "reps" | "load" | "loadUnit">>
    }
  | { type: "replaceDraft"; draft: WorkoutDraft }

let keyCounter = 0

/** Creates a client-only key. Call from event handlers, not during render. */
export function createDraftKey(prefix: string): string {
  keyCounter += 1
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : String(keyCounter)

  return `${prefix}-${random}`
}

export function createEmptyDraft(workoutDate: string, newExerciseLoadUnit: LoadUnit): WorkoutDraft {
  return {
    newExerciseLoadUnit,
    title: "",
    workoutDate,
    trainingType: "STRENGTH",
    durationMinutes: "",
    notes: "",
    exercises: [],
  }
}

/**
 * Converts a saved workout into an editable draft (keys derive from server
 * ids). Every stored set keeps its own unit; the preference is only used for
 * bodyweight sets' (unsaved) unit selector and for newly added exercises.
 */
export function draftFromWorkout(workout: WorkoutDetail, newExerciseLoadUnit: LoadUnit): WorkoutDraft {
  return {
    newExerciseLoadUnit,
    title: workout.title,
    workoutDate: workout.workoutDate,
    trainingType: workout.trainingType,
    durationMinutes: String(workout.durationMinutes),
    notes: workout.notes ?? "",
    exercises: workout.exercises.map((workoutExercise) => {
      const unitInExercise =
        workoutExercise.sets.find((set) => set.loadUnit !== null)?.loadUnit ??
        newExerciseLoadUnit

      return {
        key: `exercise-${workoutExercise.id}`,
        exercise: workoutExercise.exercise,
        sets: workoutExercise.sets.map((set) => ({
          key: `set-${set.id}`,
          reps: String(set.reps),
          load: set.load === null ? "" : String(set.load),
          loadUnit: set.loadUnit ?? unitInExercise,
        })),
      }
    }),
  }
}

function updateExercise(
  draft: WorkoutDraft,
  exerciseKey: string,
  update: (exercise: WorkoutDraftExercise) => WorkoutDraftExercise,
): WorkoutDraft {
  return {
    ...draft,
    exercises: draft.exercises.map((exercise) =>
      exercise.key === exerciseKey ? update(exercise) : exercise,
    ),
  }
}

export function workoutDraftReducer(
  draft: WorkoutDraft,
  action: WorkoutDraftAction,
): WorkoutDraft {
  switch (action.type) {
    case "setField":
      return { ...draft, [action.field]: action.value }

    case "setTrainingType":
      return { ...draft, trainingType: action.value }

    case "addExercise": {
      if (draft.exercises.length >= WORKOUT_LIMITS.maxExercises) {
        return draft
      }

      return {
        ...draft,
        exercises: [
          ...draft.exercises,
          {
            key: action.exerciseKey,
            exercise: action.exercise,
            sets: [
              {
                key: action.setKey,
                reps: "",
                load: "",
                // A new exercise starts in the preferred unit, not whatever
                // unit another exercise in this workout happens to use.
                loadUnit: draft.newExerciseLoadUnit,
              },
            ],
          },
        ],
      }
    }

    case "removeExercise":
      return {
        ...draft,
        exercises: draft.exercises.filter(
          (exercise) => exercise.key !== action.exerciseKey,
        ),
      }

    case "moveExercise": {
      const index = draft.exercises.findIndex(
        (exercise) => exercise.key === action.exerciseKey,
      )
      const target = index + action.direction

      if (index < 0 || target < 0 || target >= draft.exercises.length) {
        return draft
      }

      const exercises = [...draft.exercises]
      ;[exercises[index], exercises[target]] = [exercises[target], exercises[index]]

      return { ...draft, exercises }
    }

    case "addSet":
      return updateExercise(draft, action.exerciseKey, (exercise) => {
        if (exercise.sets.length >= WORKOUT_LIMITS.maxSetsPerExercise) {
          return exercise
        }

        // Repeated working sets are common, so a new set copies the previous one.
        const previous = exercise.sets[exercise.sets.length - 1]

        return {
          ...exercise,
          sets: [
            ...exercise.sets,
            {
              key: action.setKey,
              reps: previous?.reps ?? "",
              load: previous?.load ?? "",
              loadUnit: previous?.loadUnit ?? draft.newExerciseLoadUnit,
            },
          ],
        }
      })

    case "removeSet":
      return updateExercise(draft, action.exerciseKey, (exercise) => ({
        ...exercise,
        sets: exercise.sets.filter((set) => set.key !== action.setKey),
      }))

    case "updateSet":
      return updateExercise(draft, action.exerciseKey, (exercise) => ({
        ...exercise,
        sets: exercise.sets.map((set) =>
          set.key === action.setKey ? { ...set, ...action.patch } : set,
        ),
      }))

    case "replaceDraft":
      return action.draft
  }
}

export function isDraftEqual(a: WorkoutDraft, b: WorkoutDraft): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

// ---- Validation and serialization ------------------------------------------

/** Error message keyed by draft path (see the *ErrorKey helpers). */
export type DraftErrors = Record<string, string>

export const exerciseErrorKey = (exerciseKey: string) => `exercise:${exerciseKey}`

export const setErrorKey = (
  setKey: string,
  field: "reps" | "load" | "loadUnit",
) => `set:${setKey}:${field}`

const WHOLE_NUMBER = /^\d+$/
// Digits with up to 2 decimals; a comma is accepted as the decimal separator.
const DECIMAL_LOAD = /^(\d+([.,]\d{0,2})?|[.,]\d{1,2})$/

function parseLoad(load: string): number | null {
  const trimmed = load.trim()
  return trimmed === "" ? null : Number(trimmed.replace(",", "."))
}

export function isValidDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false
  }

  const [year, month, day] = value.split("-").map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

function getLoadError(load: string): string | null {
  const trimmed = load.trim()

  if (trimmed === "") {
    return null
  }

  if (!DECIMAL_LOAD.test(trimmed)) {
    return /^\d+[.,]\d{3,}$/.test(trimmed)
      ? "Use at most 2 decimal places."
      : "Enter a number, or leave empty for bodyweight."
  }

  const value = parseLoad(trimmed) as number

  if (value <= 0) {
    return "Leave load empty for bodyweight."
  }

  if (value > WORKOUT_LIMITS.maxLoad) {
    return `Load must be ${WORKOUT_LIMITS.maxLoad} or less.`
  }

  return null
}

/** Client-side mirror of the backend rules; the backend remains authoritative. */
export function validateDraft(draft: WorkoutDraft): DraftErrors {
  const errors: DraftErrors = {}
  const title = draft.title.trim()

  if (!title) {
    errors.title = "Enter a workout title."
  } else if (title.length > WORKOUT_LIMITS.maxTitleLength) {
    errors.title = `Title must be ${WORKOUT_LIMITS.maxTitleLength} characters or less.`
  }

  if (!isValidDateString(draft.workoutDate)) {
    errors.workoutDate = "Choose a valid date."
  }

  const duration = draft.durationMinutes.trim()

  if (!duration) {
    errors.durationMinutes = "Enter the duration in minutes."
  } else if (
    !WHOLE_NUMBER.test(duration) ||
    Number(duration) < 1 ||
    Number(duration) > WORKOUT_LIMITS.maxDurationMinutes
  ) {
    errors.durationMinutes = `Enter whole minutes from 1 to ${WORKOUT_LIMITS.maxDurationMinutes}.`
  }

  if (draft.notes.trim().length > WORKOUT_LIMITS.maxNotesLength) {
    errors.notes = `Notes must be ${WORKOUT_LIMITS.maxNotesLength} characters or less.`
  }

  if (draft.exercises.length > WORKOUT_LIMITS.maxExercises) {
    errors.exercises = `A workout can have up to ${WORKOUT_LIMITS.maxExercises} exercises.`
  }

  for (const exercise of draft.exercises) {
    if (exercise.sets.length === 0) {
      errors[exerciseErrorKey(exercise.key)] = "Add at least one set."
    } else if (exercise.sets.length > WORKOUT_LIMITS.maxSetsPerExercise) {
      errors[exerciseErrorKey(exercise.key)] =
        `An exercise can have up to ${WORKOUT_LIMITS.maxSetsPerExercise} sets.`
    }

    for (const set of exercise.sets) {
      const reps = set.reps.trim()

      if (!reps) {
        errors[setErrorKey(set.key, "reps")] = "Enter reps."
      } else if (
        !WHOLE_NUMBER.test(reps) ||
        Number(reps) < 1 ||
        Number(reps) > WORKOUT_LIMITS.maxReps
      ) {
        errors[setErrorKey(set.key, "reps")] =
          `Reps must be a whole number from 1 to ${WORKOUT_LIMITS.maxReps}.`
      }

      const loadError = getLoadError(set.load)

      if (loadError) {
        errors[setErrorKey(set.key, "load")] = loadError
      }
    }
  }

  return errors
}

function toExerciseInputs(draft: WorkoutDraft): WorkoutExerciseInput[] {
  return draft.exercises.map((exercise) => ({
    exerciseId: exercise.exercise.id,
    sets: exercise.sets.map((set) => {
      const load = parseLoad(set.load)

      // No external load is represented simply as load/loadUnit null.
      return {
        reps: Number(set.reps.trim()),
        load,
        loadUnit: load === null ? null : set.loadUnit,
      }
    }),
  }))
}

export function draftToCreateInput(
  draft: WorkoutDraft,
  recordedAt: string,
): CreateWorkoutInput {
  const notes = draft.notes.trim()

  return {
    title: draft.title.trim(),
    workoutDate: draft.workoutDate,
    trainingType: draft.trainingType,
    durationMinutes: Number(draft.durationMinutes.trim()),
    ...(notes ? { notes } : {}),
    recordedAt,
    exercises: toExerciseInputs(draft),
  }
}

/** Full replacement update: every session field plus all exercises/sets. recordedAt is untouched. */
export function draftToUpdateInput(draft: WorkoutDraft): UpdateWorkoutInput {
  const notes = draft.notes.trim()

  return {
    title: draft.title.trim(),
    workoutDate: draft.workoutDate,
    trainingType: draft.trainingType,
    durationMinutes: Number(draft.durationMinutes.trim()),
    notes: notes ? notes : null,
    exercises: toExerciseInputs(draft),
  }
}

/**
 * Maps backend validation paths (e.g. "exercises.1.sets.0.load") onto draft
 * error keys. The request is built from the draft in array order, so indexes
 * line up with the draft at save time. Unrecognized paths are returned
 * separately for a general message.
 */
export function mapServerErrors(
  draft: WorkoutDraft,
  apiErrors: ApiValidationError[],
): { errors: DraftErrors; unmatched: string[] } {
  const errors: DraftErrors = {}
  const unmatched: string[] = []
  const sessionFields = ["title", "workoutDate", "trainingType", "durationMinutes", "notes"]

  for (const apiError of apiErrors) {
    const { field, message } = apiError
    const setMatch = /^exercises\.(\d+)\.sets\.(\d+)(?:\.(reps|load|loadUnit))?$/.exec(field)
    const exerciseMatch = /^exercises\.(\d+)(?:\.(exerciseId|sets))?$/.exec(field)

    if (sessionFields.includes(field) || field === "exercises") {
      errors[field] = message
    } else if (setMatch) {
      const set = draft.exercises[Number(setMatch[1])]?.sets[Number(setMatch[2])]
      const setField = setMatch[3] === "loadUnit" ? "load" : setMatch[3] ?? "reps"

      if (set) {
        errors[setErrorKey(set.key, setField as "reps" | "load")] = message
      } else {
        unmatched.push(message)
      }
    } else if (exerciseMatch) {
      const exercise = draft.exercises[Number(exerciseMatch[1])]

      if (exercise) {
        errors[exerciseErrorKey(exercise.key)] = message
      } else {
        unmatched.push(message)
      }
    } else {
      unmatched.push(message)
    }
  }

  return { errors, unmatched }
}
