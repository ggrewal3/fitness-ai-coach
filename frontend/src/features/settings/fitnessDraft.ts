// Editable draft for the Fitness card. Inputs stay raw strings until saving.
//
// Height and target weight are stored canonically (cm, kg) but shown and
// entered in the user's preferred units (ADR-006). The no-drift rule:
//
//   - The draft records the units its measurement fields are written in, and
//     which measurements the user has actually typed into.
//   - A measurement is only sent if the user edited it AND its text differs
//     from the saved value shown in the same units. Converted display values
//     (80 kg shown as 176.4 lb, 180 cm shown as 5 ft 11 in) are therefore
//     never converted back and re-sent, so storage cannot drift.
//   - Only edited values are converted to canonical units: lb → kg rounded to
//     0.01 kg, feet and inches → cm rounded to 0.1 cm; kg and cm are kept as
//     typed.
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
import {
  bodyWeightRange,
  bodyWeightToKg,
  cmToFeetInches,
  feetInchesToCanonicalCm,
  heightInchesRange,
  parseDecimalInput,
  parseWholeNumberInput,
  type BodyWeightUnit,
  type HeightUnit,
} from '../units/units'
import { bodyWeightUnitLabel, formatBodyWeightValue, formatDecimal, formatTotalInches } from '../units/unitFormat'
import type { FieldErrors } from './profileDraft'

export const HEIGHT_CM_MIN = 50
export const HEIGHT_CM_MAX = 275
export const TARGET_WEIGHT_KG_MIN = 20
export const TARGET_WEIGHT_KG_MAX = 400
export const MINIMUM_AGE_YEARS = 13
export const MAXIMUM_AGE_YEARS = 120
export const MAX_INCHES = 11

const HEIGHT_CM_RANGE = { min: HEIGHT_CM_MIN, max: HEIGHT_CM_MAX }
const TARGET_WEIGHT_KG_RANGE = { min: TARGET_WEIGHT_KG_MIN, max: TARGET_WEIGHT_KG_MAX }

/** The units the Fitness card's measurement fields are written in. */
export type FitnessUnits = {
  bodyWeightUnit: BodyWeightUnit
  heightUnit: HeightUnit
}

export type FitnessMeasurement = 'height' | 'targetWeight'

export type FitnessDraft = {
  /** Units of the measurement fields below (fixed while the draft is dirty). */
  units: FitnessUnits
  dateOfBirth: string
  /** Height in cm; used when units.heightUnit is CM. */
  heightCm: string
  /** Whole feet and inches; used when units.heightUnit is FT_IN. */
  heightFeet: string
  heightInches: string
  /** Target weight in units.bodyWeightUnit. */
  targetWeight: string
  goal: FitnessGoal | null
  activityLevel: ActivityLevel | null
  dietPreference: DietPreference | null
  /** Measurements the user typed into. Untouched ones are never sent. */
  edited: Record<FitnessMeasurement, boolean>
}

export type FitnessDraftField = Exclude<keyof FitnessDraft, 'units' | 'edited'>

const MEASUREMENT_OF_FIELD: Partial<Record<FitnessDraftField, FitnessMeasurement>> = {
  heightCm: 'height',
  heightFeet: 'height',
  heightInches: 'height',
  targetWeight: 'targetWeight',
}

/** Validation and server errors use the API field names. */
export function fitnessErrorKey(field: FitnessDraftField): string {
  const measurement = MEASUREMENT_OF_FIELD[field]
  if (measurement === 'height') return 'heightCm'
  if (measurement === 'targetWeight') return 'targetWeightKg'
  return field
}

export function sameFitnessUnits(a: FitnessUnits, b: FitnessUnits): boolean {
  return a.bodyWeightUnit === b.bodyWeightUnit && a.heightUnit === b.heightUnit
}

/** The saved profile shown in `units`; nothing is marked edited. */
export function fitnessDraftFromProfile(profile: FitnessProfile | null, units: FitnessUnits): FitnessDraft {
  const heightCm = profile?.heightCm ?? null
  const targetWeightKg = profile?.targetWeightKg ?? null
  const feetInches = heightCm === null ? null : cmToFeetInches(heightCm)

  return {
    units,
    dateOfBirth: profile?.dateOfBirth ? profile.dateOfBirth.slice(0, 10) : '',
    heightCm: heightCm === null ? '' : formatDecimal(heightCm),
    heightFeet: feetInches === null ? '' : String(feetInches.feet),
    heightInches: feetInches === null ? '' : String(feetInches.inches),
    targetWeight: targetWeightKg === null ? '' : formatBodyWeightValue(targetWeightKg, units.bodyWeightUnit),
    goal: profile?.goal ?? null,
    activityLevel: profile?.activityLevel ?? null,
    dietPreference: profile?.dietPreference ?? null,
    edited: { height: false, targetWeight: false },
  }
}

/** Applies a user edit; measurement fields are marked as edited. */
export function updateFitnessDraft<K extends FitnessDraftField>(
  draft: FitnessDraft,
  field: K,
  value: FitnessDraft[K],
): FitnessDraft {
  const measurement = MEASUREMENT_OF_FIELD[field]
  const next = { ...draft, [field]: value }
  return measurement ? { ...next, edited: { ...draft.edited, [measurement]: true } } : next
}

// ---- Measurement parsing (in the draft's own units) -------------------------

type Parsed = { kind: 'empty' } | { kind: 'value'; value: number } | { kind: 'invalid' }

function parseDecimalField(text: string): Parsed {
  if (text.trim() === '') return { kind: 'empty' }
  const value = parseDecimalInput(text)
  return value === null ? { kind: 'invalid' } : { kind: 'value', value }
}

/** Height as whole inches (FT_IN) or cm (CM), in the draft's own unit. */
function parseHeightField(draft: FitnessDraft): Parsed {
  if (draft.units.heightUnit === 'CM') {
    return parseDecimalField(draft.heightCm)
  }

  const feetText = draft.heightFeet.trim()
  const inchesText = draft.heightInches.trim()

  if (feetText === '' && inchesText === '') return { kind: 'empty' }
  if (feetText === '') return { kind: 'invalid' }

  const feet = parseWholeNumberInput(feetText)
  // Empty inches mean 0 (e.g. "6 ft").
  const inches = inchesText === '' ? 0 : parseWholeNumberInput(inchesText)

  if (feet === null || inches === null || inches > MAX_INCHES) return { kind: 'invalid' }

  return { kind: 'value', value: feet * 12 + inches }
}

function sameParsed(a: Parsed, b: Parsed): boolean {
  if (a.kind === 'value' && b.kind === 'value') return a.value === b.value
  return a.kind === 'empty' && b.kind === 'empty'
}

function heightToCanonical(draft: FitnessDraft): number | null {
  const parsed = parseHeightField(draft)

  if (parsed.kind === 'empty') return null
  // Invalid input still counts as a change; validation blocks the save.
  if (parsed.kind === 'invalid') return Number.NaN

  return draft.units.heightUnit === 'CM'
    ? parsed.value
    : feetInchesToCanonicalCm({ feet: Math.floor(parsed.value / 12), inches: parsed.value % 12 })
}

function targetWeightToCanonical(draft: FitnessDraft): number | null {
  const parsed = parseDecimalField(draft.targetWeight)

  if (parsed.kind === 'empty') return null
  if (parsed.kind === 'invalid') return Number.NaN

  return bodyWeightToKg(parsed.value, draft.units.bodyWeightUnit)
}

/**
 * Only fields whose value differs from the saved profile, so untouched values
 * are never resent. Cleared fields become null. Measurements are compared in
 * the draft's own units (never by converting back), and only when edited.
 */
export function fitnessChanges(draft: FitnessDraft, profile: FitnessProfile | null): FitnessProfileInput {
  const saved = fitnessDraftFromProfile(profile, draft.units)
  const changes: FitnessProfileInput = {}

  if (draft.dateOfBirth !== saved.dateOfBirth) changes.dateOfBirth = draft.dateOfBirth || null
  if (draft.edited.height && !sameParsed(parseHeightField(draft), parseHeightField(saved))) {
    changes.heightCm = heightToCanonical(draft)
  }
  if (
    draft.edited.targetWeight &&
    !sameParsed(parseDecimalField(draft.targetWeight), parseDecimalField(saved.targetWeight))
  ) {
    changes.targetWeightKg = targetWeightToCanonical(draft)
  }
  if (draft.goal !== saved.goal) changes.goal = draft.goal
  if (draft.activityLevel !== saved.activityLevel) changes.activityLevel = draft.activityLevel
  if (draft.dietPreference !== saved.dietPreference) changes.dietPreference = draft.dietPreference

  return changes
}

// ---- Ranges and hints in the displayed units --------------------------------

export function heightHint(unit: HeightUnit): string {
  if (unit === 'CM') return `${HEIGHT_CM_MIN}–${HEIGHT_CM_MAX} cm`
  const inches = heightInchesRange(HEIGHT_CM_RANGE)
  return `${formatTotalInches(inches.min)}–${formatTotalInches(inches.max)}`
}

export function targetWeightRange(unit: BodyWeightUnit): { min: number; max: number } {
  return bodyWeightRange(TARGET_WEIGHT_KG_RANGE, unit)
}

export function targetWeightHint(unit: BodyWeightUnit): string {
  const range = targetWeightRange(unit)
  return `${range.min}–${range.max} ${bodyWeightUnitLabel(unit)}`
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

function validateHeight(draft: FitnessDraft): string | null {
  const parsed = parseHeightField(draft)

  if (draft.units.heightUnit === 'CM') {
    if (parsed.kind === 'invalid') return 'Enter height in cm.'
    if (parsed.kind === 'value' && (parsed.value < HEIGHT_CM_MIN || parsed.value > HEIGHT_CM_MAX)) {
      return `Must be ${heightHint('CM')}.`
    }
    return null
  }

  if (parsed.kind === 'invalid') {
    const inches = parseWholeNumberInput(draft.heightInches)
    if (draft.heightFeet.trim() === '') return 'Enter feet as well as inches.'
    if (inches !== null && inches > MAX_INCHES) return `Inches must be 0–${MAX_INCHES}.`
    return 'Use whole feet and inches.'
  }

  const range = heightInchesRange(HEIGHT_CM_RANGE)
  if (parsed.kind === 'value' && (parsed.value < range.min || parsed.value > range.max)) {
    return `Must be ${heightHint('FT_IN')}.`
  }

  return null
}

function validateTargetWeight(draft: FitnessDraft): string | null {
  const parsed = parseDecimalField(draft.targetWeight)

  // The unit suffix is decorative, so messages always name the unit.
  if (parsed.kind === 'invalid') return `Enter target weight in ${bodyWeightUnitLabel(draft.units.bodyWeightUnit)}.`
  if (parsed.kind === 'empty') return null

  // Checked on the canonical value that would be sent, reported in the shown unit.
  const kg = bodyWeightToKg(parsed.value, draft.units.bodyWeightUnit)
  if (kg < TARGET_WEIGHT_KG_MIN || kg > TARGET_WEIGHT_KG_MAX) {
    return `Must be ${targetWeightHint(draft.units.bodyWeightUnit)}.`
  }

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

  // Untouched measurements show saved values and are never sent.
  const height = draft.edited.height ? validateHeight(draft) : null
  const weight = draft.edited.targetWeight ? validateTargetWeight(draft) : null

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
