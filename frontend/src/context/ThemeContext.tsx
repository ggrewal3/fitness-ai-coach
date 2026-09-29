import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react"
import {
  THEME_STORAGE_KEY,
  applyResolvedTheme,
  getSystemPrefersDark,
  parseThemePreference,
  readStoredThemePreference,
  resolveTheme,
  storeThemePreference,
  subscribeToSystemTheme,
  type ThemePreference,
} from "../features/theme/theme"
import { ThemeContext, type ThemeContextValue } from "./theme-context"

type ThemeProviderProps = {
  children: ReactNode
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  // Same source as the index.html pre-paint script, so the first render
  // agrees with what is already on screen.
  const [preference, setPreference] = useState<ThemePreference>(() =>
    readStoredThemePreference(),
  )

  // Tracked continuously; it only affects the result while preference is
  // "system", so explicit Light/Dark ignore OS changes.
  const systemPrefersDark = useSyncExternalStore(
    subscribeToSystemTheme,
    getSystemPrefersDark,
  )

  const resolvedTheme = resolveTheme(preference, systemPrefersDark)

  // Layout effect: update <html> before the browser paints the new state.
  useLayoutEffect(() => {
    applyResolvedTheme(resolvedTheme)
  }, [resolvedTheme])

  // Follow changes made in other open tabs (the event never fires in the tab
  // that made the change). A null key means storage was cleared.
  useEffect(() => {
    function handleStorage(event: StorageEvent) {
      if (event.key === THEME_STORAGE_KEY) {
        setPreference(parseThemePreference(event.newValue))
      } else if (event.key === null) {
        setPreference(readStoredThemePreference())
      }
    }

    window.addEventListener("storage", handleStorage)

    return () => {
      window.removeEventListener("storage", handleStorage)
    }
  }, [])

  const setTheme = useCallback((next: ThemePreference) => {
    const nextPreference = parseThemePreference(next)

    storeThemePreference(nextPreference)
    setPreference(nextPreference)
  }, [])

  const value = useMemo<ThemeContextValue>(
    () => ({ preference, resolvedTheme, setTheme }),
    [preference, resolvedTheme, setTheme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
