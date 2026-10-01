import type { ReactNode } from 'react'
import { useTheme } from '../../context/useTheme'
import type { ThemePreference } from '../../features/theme/theme'
import { CheckIcon, ContrastIcon, MonitorIcon, MoonIcon, SunIcon } from '../ui/icons'
import SettingsCard from './SettingsCard'

// A miniature FitAI screen drawn with the real theme tokens. data-theme-preview
// scopes the light or dark token set to this element (see index.css), so the
// preview shows the actual palette regardless of the page's current theme.
function ThemePreview({ theme }: { theme: 'light' | 'dark' }) {
  return (
    <span className="theme-preview" data-theme-preview={theme}>
      <span className="theme-preview-sidebar">
        <span className="theme-preview-nav active" />
        <span className="theme-preview-nav" />
        <span className="theme-preview-nav" />
      </span>
      <span className="theme-preview-main">
        <span className="theme-preview-title" />
        <span className="theme-preview-card">
          <span className="theme-preview-line" />
          <span className="theme-preview-line short" />
          <span className="theme-preview-button" />
        </span>
      </span>
    </span>
  )
}

const OPTIONS: { value: ThemePreference; label: string; icon: ReactNode }[] = [
  { value: 'system', label: 'System', icon: <MonitorIcon size={18} /> },
  { value: 'light', label: 'Light', icon: <SunIcon size={18} /> },
  { value: 'dark', label: 'Dark', icon: <MoonIcon size={18} /> },
]

// Applies immediately through the Phase 2 theme infrastructure; stored only in
// this browser.
function AppearanceCard() {
  const { preference, resolvedTheme, setTheme } = useTheme()

  return (
    <SettingsCard
      icon={<ContrastIcon />}
      title="Appearance"
      titleId="settings-appearance-title"
      description="Saved on this device and applied instantly."
    >
      <fieldset className="theme-options">
        <legend className="sr-only">Theme</legend>
        {OPTIONS.map((option) => {
          const captionId = `settings-theme-${option.value}-caption`

          return (
            <label key={option.value} className="theme-option">
              <input
                className="sr-only"
                type="radio"
                name="theme"
                value={option.value}
                checked={preference === option.value}
                onChange={() => setTheme(option.value)}
                aria-describedby={option.value === 'system' ? captionId : undefined}
              />
              <span className="theme-option-preview">
                {option.value === 'system' ? (
                  <span className="theme-preview-split">
                    <ThemePreview theme="light" />
                    <ThemePreview theme="dark" />
                  </span>
                ) : (
                  <ThemePreview theme={option.value} />
                )}
              </span>
              <span className="theme-option-footer">
                <span className="theme-option-icon">{option.icon}</span>
                <span className="theme-option-text">
                  <span className="theme-option-label">{option.label}</span>
                  {option.value === 'system' && (
                    <span id={captionId} className="theme-option-caption">
                      Currently {resolvedTheme === 'dark' ? 'Dark' : 'Light'}
                    </span>
                  )}
                </span>
                <span className="theme-option-check" aria-hidden="true">
                  <CheckIcon size={14} />
                </span>
              </span>
            </label>
          )
        })}
      </fieldset>
    </SettingsCard>
  )
}

export default AppearanceCard
