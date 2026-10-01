import type { ReactNode } from 'react'
import { AlertIcon, CheckIcon } from '../ui/icons'

export type CardStatus = 'idle' | 'dirty' | 'saving' | 'saved'

type SettingsCardProps = {
  icon: ReactNode
  title: string
  titleId: string
  description?: ReactNode
  /** Neutral status label shown in the header, e.g. "Not connected". */
  badge?: string
  status?: CardStatus
  className?: string
  children: ReactNode
  footer?: ReactNode
}

function StatusBadge({ status, badge }: { status: CardStatus; badge?: string }) {
  if (status === 'dirty') {
    return <span className="settings-badge settings-badge-warning">Unsaved changes</span>
  }

  if (status === 'saved') {
    return (
      <span className="settings-badge settings-badge-success">
        <CheckIcon size={14} />
        Saved
      </span>
    )
  }

  return badge ? <span className="settings-badge">{badge}</span> : null
}

// One Settings card: icon tile, title, description, status badge, body, and an
// optional footer (used for the section-local Save/Cancel bar).
function SettingsCard({
  icon,
  title,
  titleId,
  description,
  badge,
  status = 'idle',
  className,
  children,
  footer,
}: SettingsCardProps) {
  return (
    <article className={['settings-card', className].filter(Boolean).join(' ')} aria-labelledby={titleId}>
      <header className="settings-card-header">
        <span className="settings-icon-tile" aria-hidden="true">
          {icon}
        </span>
        <div className="settings-card-heading">
          <h3 id={titleId}>{title}</h3>
          {description && <p className="settings-card-description">{description}</p>}
        </div>
        <StatusBadge status={status} badge={badge} />
      </header>
      <div className="settings-card-body">{children}</div>
      {footer}
    </article>
  )
}

type SaveFooterProps = {
  visible: boolean
  isSaving: boolean
  saveLabel?: string
  saveDisabled?: boolean
  error: string | null
  onCancel: () => void
  onSave: () => void
}

/**
 * Section-local Save/Cancel bar. It appears only while the card has unsaved
 * changes (or a save is in flight / failed) and sticks to the bottom of the
 * viewport while its card is on screen.
 */
export function SaveFooter({
  visible,
  isSaving,
  saveLabel = 'Save changes',
  saveDisabled = false,
  error,
  onCancel,
  onSave,
}: SaveFooterProps) {
  if (!visible) {
    return null
  }

  return (
    <div className="settings-save-footer">
      {error && (
        <p className="settings-save-error" role="alert">
          <AlertIcon size={18} />
          <span>{error}</span>
        </p>
      )}
      <div className="settings-save-row">
        <span className="settings-save-hint">{isSaving ? 'Saving…' : 'You have unsaved changes'}</span>
        <div className="settings-save-actions">
          <button type="button" className="dashboard-secondary-button" onClick={onCancel} disabled={isSaving}>
            Cancel
          </button>
          <button
            type="button"
            className="dashboard-primary-button"
            onClick={onSave}
            disabled={isSaving || saveDisabled}
          >
            {isSaving ? 'Saving…' : saveLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export default SettingsCard
