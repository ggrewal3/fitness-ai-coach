import {
  createExercise,
  getExercises,
  type Exercise,
  type FindOrCreateExerciseResult,
} from "./api"

export type { Exercise, FindOrCreateExerciseResult }

// Deterministic backend search over built-in exercises and the user's own
// custom exercises (never another user's).
export async function searchExercises(
  search: string,
  limit: number,
  signal?: AbortSignal,
): Promise<Exercise[]> {
  return getExercises(search, limit, signal)
}

// Find-or-create: returns an existing built-in/custom exercise with the same
// normalized name, or creates a private custom exercise.
export async function findOrCreateExercise(
  name: string,
): Promise<FindOrCreateExerciseResult> {
  return createExercise(name)
}
