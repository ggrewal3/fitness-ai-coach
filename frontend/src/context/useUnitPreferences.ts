import { useContext } from "react"
import { UnitPreferencesContext } from "./unit-preferences-context"

export function useUnitPreferences() {
  const context = useContext(UnitPreferencesContext)

  if (!context) {
    throw new Error("useUnitPreferences must be used within a UnitPreferencesProvider")
  }

  return context
}
