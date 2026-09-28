import {
  createWorkout,
  deleteWorkout,
  getWorkout,
  getWorkouts,
  getWorkoutsForDate,
  updateWorkout,
  type CreateWorkoutInput,
  type LoadUnit,
  type TrainingType,
  type UpdateWorkoutInput,
  type WorkoutDetail,
  type WorkoutExercise,
  type WorkoutExerciseInput,
  type WorkoutListQuery,
  type WorkoutSet,
  type WorkoutSetInput,
  type WorkoutSummary,
} from "./api"

export type {
  CreateWorkoutInput,
  LoadUnit,
  TrainingType,
  UpdateWorkoutInput,
  WorkoutDetail,
  WorkoutExercise,
  WorkoutExerciseInput,
  WorkoutListQuery,
  WorkoutSet,
  WorkoutSetInput,
  WorkoutSummary,
}

export async function fetchWorkoutsForDate(
  workoutDate: string,
): Promise<WorkoutDetail[]> {
  return getWorkoutsForDate(workoutDate)
}

export async function fetchRecentWorkouts(limit: number): Promise<WorkoutSummary[]> {
  return getWorkouts({ limit })
}

export async function fetchWorkout(id: number): Promise<WorkoutDetail> {
  return getWorkout(id)
}

export async function addWorkout(input: CreateWorkoutInput): Promise<WorkoutDetail> {
  return createWorkout(input)
}

// Replacement-style update: when `exercises` is sent, the backend replaces all
// of the workout's exercises and sets in one transaction.
export async function editWorkout(
  id: number,
  input: UpdateWorkoutInput,
): Promise<WorkoutDetail> {
  return updateWorkout(id, input)
}

export async function removeWorkout(id: number): Promise<void> {
  await deleteWorkout(id)
}

export const TRAINING_TYPE_LABELS: Record<TrainingType, string> = {
  STRENGTH: "Strength",
  CARDIO: "Cardio",
  MOBILITY: "Mobility",
  SPORT: "Sport",
  OTHER: "Other",
}

export const TRAINING_TYPE_ORDER: TrainingType[] = [
  "STRENGTH",
  "CARDIO",
  "MOBILITY",
  "SPORT",
  "OTHER",
]

export function formatLoad(load: number): string {
  // JSON numbers from the API have at most 2 decimals; String() drops
  // trailing zeros (155.50 -> "155.5").
  return String(load)
}

export function formatWorkoutSet(set: Pick<WorkoutSet, "reps" | "load" | "loadUnit">): string {
  if (set.load === null || set.loadUnit === null) {
    return `${set.reps} ${set.reps === 1 ? "rep" : "reps"}`
  }

  return `${formatLoad(set.load)} ${set.loadUnit.toLowerCase()} × ${set.reps}`
}
