// Display strings for measurements. Conversion lives in units.ts; this file
// only turns numbers into text, so components never do unit arithmetic.
import {
  DISPLAY_DECIMALS,
  INCHES_PER_FOOT,
  bodyWeightFromKg,
  cmToFeetInches,
  roundTo,
  type BodyWeightUnit,
  type FeetInches,
  type HeightUnit,
} from "./units"

const BODY_WEIGHT_LABELS: Record<BodyWeightUnit, string> = { KG: "kg", LB: "lb" }
const HEIGHT_LABELS: Record<HeightUnit, string> = { CM: "cm", FT_IN: "feet and inches" }

export function bodyWeightUnitLabel(unit: BodyWeightUnit): string {
  return BODY_WEIGHT_LABELS[unit]
}

export function heightUnitLabel(unit: HeightUnit): string {
  return HEIGHT_LABELS[unit]
}

/** At most one decimal, trailing zeros trimmed: 80 → "80", 176.40 → "176.4". */
export function formatDecimal(value: number): string {
  return String(roundTo(value, DISPLAY_DECIMALS))
}

/** The number alone, in the display unit (for inputs and split layouts). */
export function formatBodyWeightValue(kg: number, unit: BodyWeightUnit): string {
  return String(bodyWeightFromKg(kg, unit))
}

/** "80 kg", "176.4 lb". */
export function formatBodyWeight(kg: number, unit: BodyWeightUnit): string {
  return `${formatBodyWeightValue(kg, unit)} ${bodyWeightUnitLabel(unit)}`
}

/** "5 ft 11 in". */
export function formatFeetInches({ feet, inches }: FeetInches): string {
  return `${feet} ft ${inches} in`
}

/** Whole inches as feet and inches: 108 → "9 ft 0 in". */
export function formatTotalInches(totalInches: number): string {
  return formatFeetInches({
    feet: Math.floor(totalInches / INCHES_PER_FOOT),
    inches: totalInches % INCHES_PER_FOOT,
  })
}

/** "180 cm", "5 ft 11 in". */
export function formatHeight(cm: number, unit: HeightUnit): string {
  return unit === "FT_IN" ? formatFeetInches(cmToFeetInches(cm)) : `${formatDecimal(cm)} cm`
}
