// Theme preference and resolution. The preference ("system" | "light" | "dark")
// lives only in this browser's localStorage; <html data-theme> always holds the
// resolved visual theme ("light" | "dark"), never "system".
//
// Keep in sync with the pre-paint script in index.html, which repeats the
// storage key, the accepted values, the media query and the two DOM writes of
// applyResolvedTheme so the first paint already uses the right theme.

export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'fitai.theme'
export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'system'

const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)'

/** Anything other than an exact, known value falls back to System. */
export function parseThemePreference(value: unknown): ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark'
    ? value
    : DEFAULT_THEME_PREFERENCE
}

// localStorage can be unavailable (blocked site data, some private modes), in
// which case reads fall back to System and writes last only for this session.
export function readStoredThemePreference(): ThemePreference {
  try {
    return parseThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY))
  } catch {
    return DEFAULT_THEME_PREFERENCE
  }
}

export function storeThemePreference(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference)
  } catch {
    // Not persisted; the preference still applies until the page is reloaded.
  }
}

export function getSystemPrefersDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(SYSTEM_DARK_QUERY).matches
}

/** Subscribes to OS light/dark changes; returns the unsubscribe function. */
export function subscribeToSystemTheme(onChange: () => void): () => void {
  if (typeof window.matchMedia !== 'function') {
    return () => {}
  }

  const query = window.matchMedia(SYSTEM_DARK_QUERY)
  query.addEventListener('change', onChange)

  return () => query.removeEventListener('change', onChange)
}

export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference === 'system') {
    return systemPrefersDark ? 'dark' : 'light'
  }

  return preference
}

/** data-theme drives the CSS tokens; color-scheme makes native controls follow. */
export function applyResolvedTheme(theme: ResolvedTheme): void {
  const root = document.documentElement
  root.dataset.theme = theme
  root.style.colorScheme = theme
}
