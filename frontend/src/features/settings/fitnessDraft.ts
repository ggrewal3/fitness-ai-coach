// Editable draft for the Fitness card. Inputs stay raw strings until saving.
// Height is entered in cm and target weight in kg (the canonical storage
// units); display in the user's preferred units is Phase 4 work.
//
// Validation mirrors backend/src/modules/profile/profile.schemas.ts; the
// backend stays authoritative.
import type {
  ActivityLevel,
  DietPreference,
  FitnessGoal,
  FitnessProfile,
  FitnessProfileInput,
} from '../../services/fitnessProfile'
import type { FieldErrors } from './profileDraft'

export const HEIGHT_CM_MIN = 50
export const HEIGHT_CM_MAX = 275
export const TARGET_WEIGHT_KG_MIN = 20
export const TARGET_WEIGHT_KG_MAX = 400
export const MINIMUM_AGE_YEARS = 13
export const MAXIMUM_AGE_YEARS = 120

export type FitnessDraft = {
  dateOfBirth: string
  heightCm: string
  targetWeightKg: string
  goal: FitnessGoal | null
  activityLevel: ActivityLevel | null
  dietPreference: DietPreference | null
}

export const EMPTY_FITNESS_DRAFT: FitnessDraft = {
  dateOfBirth: '',
  heightCm: '',
  targetWeightKg: '',
  goal: null,
  activityLevel: null,
  dietPreference: null,
}

export function fitnessDraftFromProfile(profile: FitnessProfile | null): FitnessDraft {
  if (!profile) {
    return EMPTY_FITNESS_DRAFT
  }

  return {
    dateOfBirth: profile.dateOfBirth ? profile.dateOfBirth.slice(0, 10) : '',
    heightCm: profile.heightCm === null ? '' : String(profile.heightCm),
    targetWeightKg: profile.targetWeightKg === null ? '' : String(profile.targetWeightKg),
    goal: profile.goal,
    activityLevel: profile.activityLevel,
    dietPreference: profile.dietPreference,
  }
}

function toNumberOrNull(value: string): number | null {
  return value.trim() === '' ? null : Number(value)
}

/**
 * Only fields whose value differs from the saved profile, so untouched values
 * are never resent. Cleared fields become null.
 */
export function fitnessChanges(
  draft: FitnessDraft,
  profile: FitnessProfile | null,
): FitnessProfileInput {
  const saved = fitnessDraftFromProfile(profile)
  const changes: FitnessProfileInput = {}

  if (draft.dateOfBirth !== saved.dateOfBirth) changes.dateOfBirth = draft.dateOfBirth || null
  if (toNumberOrNull(draft.heightCm) !== toNumberOrNull(saved.heightCm)) changes.heightCm = toNumberOrNull(draft.heightCm)
  if (toNumberOrNull(draft.targetWeightKg) !== toNumberOrNull(saved.targetWeightKg)) {
    changes.targetWeightKg = toNumberOrNull(draft.targetWeightKg)
  }
  if (draft.goal !== saved.goal) changes.goal = draft.goal
  if (draft.activityLevel !== saved.activityLevel) changes.activityLevel = draft.activityLevel
  if (draft.dietPreference !== saved.dietPreference) changes.dietPreference = draft.dietPreference

  return changes
}

function utcToday(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

function yearsBefore(date: Date, years: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear() - years, date.getUTCMonth(), date.getUTCDate()))
}

function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** Bounds for the native date input: oldest and youngest allowed birth dates. */
export function dateOfBirthBounds(): { min: string; max: string } {
  const today = utcToday()
  return {
    min: toDateString(yearsBefore(today, MAXIMUM_AGE_YEARS)),
    max: toDateString(yearsBefore(today, MINIMUM_AGE_YEARS)),
  }
}

function parseDateString(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null
  }

  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isNaN(date.getTime()) || toDateString(date) !== value ? null : date
}

/** Whole years between the birth date and today (UTC), or null. */
export function ageFromDateOfBirth(value: string): number | null {
  const date = parseDateString(value)

  if (!date) {
    return null
  }

  const today = utcToday()
  let age = today.getUTCFullYear() - date.getUTCFullYear()

  if (
    today.getUTCMonth() < date.getUTCMonth() ||
    (today.getUTCMonth() === date.getUTCMonth() && today.getUTCDate() < date.getUTCDate())
  ) {
    age -= 1
  }

  return age >= 0 ? age : null
}

function checkRange(value: string, min: number, max: number, unit: string, label: string): string | null {
  if (value.trim() === '') {
    return null
  }

  const number = Number(value)

  if (!Number.isFinite(number)) return `Enter ${label} as a number.`
  if (number < min || number > max) return `Must be ${min}–${max} ${unit}.`

  return null
}

export function validateFitness(draft: FitnessDraft): FieldErrors {
  const errors: FieldErrors = {}

  if (draft.dateOfBirth) {
    const date = parseDateString(draft.dateOfBirth)
    const today = utcToday()

    if (!date) errors.dateOfBirth = 'Enter a valid date.'
    else if (date >= today) errors.dateOfBirth = 'Date of birth must be in the past.'
    else if (date > yearsBefore(today, MINIMUM_AGE_YEARS)) errors.dateOfBirth = `You must be ${MINIMUM_AGE_YEARS} or older.`
    else if (date < yearsBefore(today, MAXIMUM_AGE_YEARS)) errors.dateOfBirth = 'Enter a realistic date of birth.'
  }

  const height = checkRange(draft.heightCm, HEIGHT_CM_MIN, HEIGHT_CM_MAX, 'cm', 'height')
  const weight = checkRange(draft.targetWeightKg, TARGET_WEIGHT_KG_MIN, TARGET_WEIGHT_KG_MAX, 'kg', 'target weight')

  if (height) errors.heightCm = height
  if (weight) errors.targetWeightKg = weight

  return errors
}

export const GOAL_OPTIONS: { value: FitnessGoal; label: string; description: string }[] = [
  { value: 'LOSE_FAT', label: 'Lose fat', description: 'Reduce body fat while keeping your strength.' },
  { value: 'MAINTAIN', label: 'Maintain', description: 'Hold your current weight and build consistency.' },
  { value: 'GAIN_MUSCLE', label: 'Build muscle', description: 'Add muscle with progressive training.' },
]

export const ACTIVITY_OPTIONS: { value: ActivityLevel; label: string; description: string; level: number }[] = [
  { value: 'SEDENTARY', label: 'Sedentary', description: 'Mostly sitting, little planned exercise.', level: 1 },
  { value: 'LIGHT', label: 'Lightly active', description: 'Light exercise 1–3 days a week.', level: 2 },
  { value: 'MODERATE', label: 'Moderately active', description: 'Exercise 3–5 days a week.', level: 3 },
  { value: 'ACTIVE', label: 'Active', description: 'Hard exercise 6–7 days a week.', level: 4 },
  { value: 'VERY_ACTIVE', label: 'Very active', description: 'Physical job or training twice a day.', level: 5 },
]

export const DIET_OPTIONS: { value: DietPreference; label: string }[] = [
  { value: 'NO_PREFERENCE', label: 'No preference' },
  { value: 'VEGETARIAN', label: 'Vegetarian' },
  { value: 'VEGAN', label: 'Vegan' },
  { value: 'PESCATARIAN', label: 'Pescatarian' },
  { value: 'HALAL', label: 'Halal' },
]

export function goalLabel(goal: FitnessGoal | null): string | null {
  return GOAL_OPTIONS.find((option) => option.value === goal)?.label ?? null
}
