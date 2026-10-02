import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { fetchAccount, type UnitPreferences } from "../services/account"
import {
  DEFAULT_UNIT_PREFERENCES,
  UnitPreferencesContext,
  type UnitPreferencesContextValue,
} from "./unit-preferences-context"

type UnitPreferencesProviderProps = {
  children: ReactNode
}

/**
 * Unit preferences for the signed-in app (mounted by AppLayout, so public
 * pages never load them). Fetches the account once; on failure the backend
 * defaults (KG / LB / CM) are used, since preferences only affect display.
 * There is no cross-tab sync: other tabs pick changes up on their next load.
 */
export function UnitPreferencesProvider({ children }: UnitPreferencesProviderProps) {
  const [preferences, setPreferencesState] = useState<UnitPreferences>(DEFAULT_UNIT_PREFERENCES)
  const [isLoading, setIsLoading] = useState(true)
  // Set once Settings supplies confirmed preferences, so a slower initial
  // response can never overwrite them.
  const hasConfirmedRef = useRef(false)

  useEffect(() => {
    let isCurrent = true

    async function load() {
      try {
        const account = await fetchAccount()

        if (isCurrent && !hasConfirmedRef.current) {
          setPreferencesState(account.preferences)
        }
      } catch {
        // Keep the defaults; a 401 is already handled by the API client.
      } finally {
        if (isCurrent) {
          setIsLoading(false)
        }
      }
    }

    void load()

    return () => {
      isCurrent = false
    }
  }, [])

  const setPreferences = useCallback((next: Partial<UnitPreferences>) => {
    hasConfirmedRef.current = true
    setPreferencesState((current) => ({ ...current, ...next }))
    setIsLoading(false)
  }, [])

  const value = useMemo<UnitPreferencesContextValue>(
    () => ({ preferences, isLoading, setPreferences }),
    [preferences, isLoading, setPreferences],
  )

  return <UnitPreferencesContext.Provider value={value}>{children}</UnitPreferencesContext.Provider>
}
