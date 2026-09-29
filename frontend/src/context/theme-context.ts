import { createContext } from "react"
import type {
  ResolvedTheme,
  ThemePreference,
} from "../features/theme/theme"

export type ThemeContextValue = {
  /** What the user chose; "system" follows the OS. */
  preference: ThemePreference
  /** The theme actually shown. */
  resolvedTheme: ResolvedTheme
  setTheme: (preference: ThemePreference) => void
}

export const ThemeContext = createContext<ThemeContextValue | undefined>(
  undefined,
)
