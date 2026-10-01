import type { ReactNode } from 'react'
import { fieldMessageId } from '../../features/settings/fieldIds'
import { AlertIcon } from '../ui/icons'

type SettingsFieldProps = {
  id: string
  label: string
  optional?: boolean
  /** Helper text; replaced by the error while one is present. */
  hint?: ReactNode
  error?: string
  /** Shown instead of the hint when the backend normalized the saved value. */
  note?: string | null
  className?: string
  children: ReactNode
}

// Label + control + a message line that always reserves one line of space, so
// errors replace helper text instead of shifting the layout.
function SettingsField({ id, label, optional, hint, error, note, className, children }: SettingsFieldProps) {
  const active = error ? 'error' : note ? 'note' : 'hint'

  return (
    <div className={['settings-field', className].filter(Boolean).join(' ')}>
      <label htmlFor={id} className="settings-label">
        {label}
        {optional && <span className="settings-optional">Optional</span>}
      </label>
      {children}
      {/* Hint, note and error share one grid cell, so the line is as tall as
          the tallest of them and switching between them never shifts layout.
          Only the active one is visible (and read by screen readers). */}
      <p id={fieldMessageId(id)} className="settings-field-message">
        <span className={active === 'hint' ? 'settings-message' : 'settings-message inactive'}>{hint}</span>
        {note && <span className={active === 'note' ? 'settings-message note' : 'settings-message note inactive'}>{note}</span>}
        {error && (
          <span className="settings-message error">
            <AlertIcon size={16} />
            <span>{error}</span>
          </span>
        )}
      </p>
    </div>
  )
}

export default SettingsField
