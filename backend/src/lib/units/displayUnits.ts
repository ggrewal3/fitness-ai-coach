// Display strings in the user's preferred units, for AI context only.
//
// This mirrors the frontend's Phase 4 policy (frontend/src/features/units/)
// exactly, and a backend test checks the two agree: exact factors, at most
// one decimal for kg/lb/cm, whole inches for feet and inches. Stored values
// stay canonical (kg, cm); these strings are presentation only (ADR-006).

export type BodyWeightUnit = "KG" | "LB";
export type HeightUnit = "CM" | "FT_IN";

export const KG_PER_LB = 0.45359237;
export const CM_PER_INCH = 2.54;
export const INCHES_PER_FOOT = 12;
const DISPLAY_DECIMALS = 1;

/** Rounds half up to a number of decimal places, without returning -0. */
export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  return rounded === 0 ? 0 : rounded;
}

function bodyWeightValue(kg: number, unit: BodyWeightUnit): number {
  return roundTo(unit === "LB" ? kg / KG_PER_LB : kg, DISPLAY_DECIMALS);
}

function bodyWeightLabel(unit: BodyWeightUnit): string {
  return unit === "LB" ? "lb" : "kg";
}

/** "80 kg", "176.4 lb". */
export function formatBodyWeight(kg: number, unit: BodyWeightUnit): string {
  return `${bodyWeightValue(kg, unit)} ${bodyWeightLabel(unit)}`;
}

/**
 * A signed change: "+0.4 lb", "-1.3 kg", "0 kg". The magnitude is rounded,
 * then the sign applied, so gains and losses of the same size match.
 */
export function formatBodyWeightChange(kg: number, unit: BodyWeightUnit): string {
  const magnitude = bodyWeightValue(Math.abs(kg), unit);
  const sign = magnitude === 0 ? "" : kg > 0 ? "+" : "-";
  return `${sign}${magnitude} ${bodyWeightLabel(unit)}`;
}

/** "180 cm", "5 ft 11 in" (nearest whole inch, rolling over into feet). */
export function formatHeight(cm: number, unit: HeightUnit): string {
  if (unit === "CM") {
    return `${roundTo(cm, DISPLAY_DECIMALS)} cm`;
  }

  const totalInches = Math.round(cm / CM_PER_INCH);
  return `${Math.floor(totalInches / INCHES_PER_FOOT)} ft ${totalInches % INCHES_PER_FOOT} in`;
}
