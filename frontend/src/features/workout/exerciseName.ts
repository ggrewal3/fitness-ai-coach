// Client-side mirror of the backend's exercise-name rules
// (backend/src/modules/exercises/exercise.normalize.ts and exercise.schemas.ts).
// The backend remains authoritative; this only decides when the picker can
// offer "Create" and how to spot an exact match in search results.

const EXERCISE_NAME_ALLOWED = /^[\p{L}\p{N} \-'’()/&.,+]+$/u
const HAS_LETTER_OR_NUMBER = /[\p{L}\p{N}]/u

export const EXERCISE_NAME_MIN_LENGTH = 2
export const EXERCISE_NAME_MAX_LENGTH = 60

export function toExerciseDisplayName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ")
}

export function toExerciseNormalizedName(value: string): string {
  return toExerciseDisplayName(value)
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/** Returns an error message, or null when the display name is valid. */
export function getExerciseNameError(displayName: string): string | null {
  if (
    displayName.length < EXERCISE_NAME_MIN_LENGTH ||
    displayName.length > EXERCISE_NAME_MAX_LENGTH
  ) {
    return `Exercise names must be ${EXERCISE_NAME_MIN_LENGTH}–${EXERCISE_NAME_MAX_LENGTH} characters.`
  }

  if (!EXERCISE_NAME_ALLOWED.test(displayName)) {
    return "Exercise names can use letters, numbers, spaces and - ' ( ) / & . , +"
  }

  if (!HAS_LETTER_OR_NUMBER.test(displayName)) {
    return "Exercise names must contain a letter or number."
  }

  return null
}
