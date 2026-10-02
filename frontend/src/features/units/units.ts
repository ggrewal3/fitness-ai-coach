// Pure unit conversion for display/input preferences (ADR-006, ADR-007).
//
// Storage is canonical: body and target weight in kg, height in cm. Workout
// set loads keep their own unit and are never converted. Preferences only
// change how values are shown and entered, so conversions happen at the UI
// edge and only for values the user actually typed.
//
// No React and no runtime imports: this module is unit-tested with node --test.

export type BodyWeightUnit = "KG" | "LB"
export type HeightUnit = "CM" | "FT_IN"

/** Exact international definition (ADR-006). */
export const KG_PER_LB = 0.45359237
export const CM_PER_INCH = 2.54
export const INCHES_PER_FOOT = 12

/** Decimal places shown for kg, lb and cm. */
export const DISPLAY_DECIMALS = 1
/** Canonical precision of kg converted from user-entered lb. */
export const CANONICAL_KG_DECIMALS = 2
/** Canonical precision of cm converted from user-entered feet and inches. */
export const CANONICAL_CM_DECIMALS = 1

export type FeetInches = { feet: number; inches: number }

/** Rounds half up to a number of decimal places, without returning -0. */
export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals
  const rounded = Math.round(value * factor) / factor
  return rounded === 0 ? 0 : rounded
}

export function kgToLb(kg: number): number {
  return kg / KG_PER_LB
}

export function lbToKg(lb: number): number {
  return lb * KG_PER_LB
}

/** Nearest whole inch, split into feet and inches (71.9 in → 6 ft 0 in). */
export function cmToFeetInches(cm: number): FeetInches {
  const totalInches = Math.round(cm / CM_PER_INCH)
  return { feet: Math.floor(totalInches / INCHES_PER_FOOT), inches: totalInches % INCHES_PER_FOOT }
}

export function feetInchesToCm(feet: number, inches: number): number {
  return (feet * INCHES_PER_FOOT + inches) * CM_PER_INCH
}

// ---- Parsing -----------------------------------------------------------------

const DECIMAL_INPUT = /^(\d+([.,]\d*)?|[.,]\d+)$/
const WHOLE_NUMBER_INPUT = /^\d+$/

/** A non-negative decimal typed by the user ("." or ","), or null if blank or invalid. */
export function parseDecimalInput(text: string): number | null {
  const trimmed = text.trim()
  return DECIMAL_INPUT.test(trimmed) ? Number(trimmed.replace(",", ".")) : null
}

/** A non-negative whole number typed by the user, or null if blank or invalid. */
export function parseWholeNumberInput(text: string): number | null {
  const trimmed = text.trim()
  return WHOLE_NUMBER_INPUT.test(trimmed) ? Number(trimmed) : null
}

// ---- Canonical ↔ display -----------------------------------------------------

/** Canonical kg as a display-unit number, rounded for display. */
export function bodyWeightFromKg(kg: number, unit: BodyWeightUnit): number {
  return roundTo(unit === "LB" ? kgToLb(kg) : kg, DISPLAY_DECIMALS)
}

/**
 * A value the user entered in `unit`, as canonical kg. kg is kept as typed;
 * lb is converted and rounded to 0.01 kg. Call this only for edited values.
 */
export function bodyWeightToKg(value: number, unit: BodyWeightUnit): number {
  return unit === "LB" ? roundTo(lbToKg(value), CANONICAL_KG_DECIMALS) : value
}

/** Feet and inches the user entered, as canonical cm rounded to 0.1 cm. */
export function feetInchesToCanonicalCm({ feet, inches }: FeetInches): number {
  return roundTo(feetInchesToCm(feet, inches), CANONICAL_CM_DECIMALS)
}

// ---- Ranges ------------------------------------------------------------------

export type NumberRange = { min: number; max: number }

/**
 * A canonical kg range expressed in `unit`, rounded inwards to the display
 * precision so every value shown as allowed really is allowed (20–400 kg →
 * 44.1–881.8 lb).
 */
export function bodyWeightRange(range: NumberRange, unit: BodyWeightUnit): NumberRange {
  if (unit === "KG") {
    return range
  }

  const factor = 10 ** DISPLAY_DECIMALS
  return {
    min: Math.ceil(roundTo(kgToLb(range.min) * factor, 6)) / factor,
    max: Math.floor(roundTo(kgToLb(range.max) * factor, 6)) / factor,
  }
}

/** A canonical cm range as whole inches, rounded inwards (50–275 cm → 20–108 in). */
export function heightInchesRange(range: NumberRange): NumberRange {
  return {
    min: Math.ceil(roundTo(range.min / CM_PER_INCH, 6)),
    max: Math.floor(roundTo(range.max / CM_PER_INCH, 6)),
  }
}
