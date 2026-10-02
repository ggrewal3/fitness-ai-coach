import { createContext } from "react"
import type { UnitPreferences } from "../services/account"

export type UnitPreferencesContextValue = {
  /** The signed-in user's display/input units (defaults until loaded). */
  preferences: UnitPreferences
  /** True until the first preferences request settles. */
  isLoading: boolean
  /**
   * Applies preferences the server has just confirmed (e.g. from Settings).
   * Fields are merged, so a save of one unit never resets another.
   */
  setPreferences: (preferences: Partial<UnitPreferences>) => void
}

/** Same defaults the backend returns when no preference row exists. */
export const DEFAULT_UNIT_PREFERENCES: UnitPreferences = {
  bodyWeightUnit: "KG",
  workoutLoadUnit: "LB",
  heightUnit: "CM",
}

export const UnitPreferencesContext = createContext<UnitPreferencesContextValue | undefined>(
  undefined,
)
