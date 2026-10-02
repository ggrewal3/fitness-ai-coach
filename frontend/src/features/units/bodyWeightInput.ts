// Weight check-in input: parsed in the user's preferred unit, validated on the
// canonical kg that will actually be sent, and reported in the shown unit.
// Mirrors backend/src/modules/checkins/checkin.schemas.ts (> 0, ≤ 500 kg); the
// backend stays authoritative.
import { bodyWeightRange, bodyWeightToKg, parseDecimalInput, type BodyWeightUnit } from "./units"
import { bodyWeightUnitLabel } from "./unitFormat"

export const CHECK_IN_WEIGHT_KG_MAX = 500

export type CheckInWeightResult = { ok: true; kg: number } | { ok: false; message: string }

/** Largest check-in weight in `unit` (500 kg → 1102.3 lb). */
export function checkInWeightMax(unit: BodyWeightUnit): number {
  return bodyWeightRange({ min: 0, max: CHECK_IN_WEIGHT_KG_MAX }, unit).max
}

export function checkInWeightToKg(text: string, unit: BodyWeightUnit): CheckInWeightResult {
  const label = bodyWeightUnitLabel(unit)
  const value = parseDecimalInput(text)
  const kg = value === null ? null : bodyWeightToKg(value, unit)

  if (kg === null || kg <= 0) {
    return { ok: false, message: `Enter a valid weight in ${label}.` }
  }

  if (kg > CHECK_IN_WEIGHT_KG_MAX) {
    return { ok: false, message: `Enter a weight up to ${checkInWeightMax(unit)} ${label}.` }
  }

  return { ok: true, kg }
}
