import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { saveAccountProfile, type Account } from '../../services/account'
import { fieldMessageId, settingsFieldId } from '../../features/settings/fieldIds'
import {
  BIO_MAX_LENGTH,
  BIO_WARNING_LENGTH,
  bioChanges,
  bioLength,
  validateBio,
} from '../../features/settings/profileDraft'
import { describeSaveFailure, useSavedFlash } from '../../features/settings/saveFeedback'
import { AlertIcon, LockIcon, SparkIcon } from '../ui/icons'
import SettingsCard, { SaveFooter } from './SettingsCard'

type AboutYouCardProps = {
  account: Account
  onSaved: (account: Account) => void
  onDirtyChange: (isDirty: boolean) => void
  announce: (message: string) => void
}

type CounterZone = 'ok' | 'near' | 'over'

function counterZone(length: number): CounterZone {
  if (length > BIO_MAX_LENGTH) return 'over'
  if (length >= BIO_WARNING_LENGTH) return 'near'
  return 'ok'
}

const BIO_ID = settingsFieldId('about', 'bio')

// Bio has its own save boundary so saving contact details never saves a
// half-written bio (and vice versa).
function AboutYouCard({ account, onSaved, onDirtyChange, announce }: AboutYouCardProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [draft, setDraft] = useState(() => account.bio ?? '')
  const [serverError, setServerError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isSaved, flashSaved] = useSavedFlash()

  const changes = bioChanges(draft, account)
  const isDirty = Object.keys(changes).length > 0
  const length = bioLength(draft)
  const zone = counterZone(length)
  const validationError = validateBio(draft)
  const error = validationError ?? serverError

  useEffect(() => {
    onDirtyChange(isDirty)
  }, [isDirty, onDirtyChange])

  // Grow with the content (no inner scrollbar); CSS sets the minimum height.
  useLayoutEffect(() => {
    const textarea = textareaRef.current

    if (textarea) {
      textarea.style.height = 'auto'
      textarea.style.height = `${textarea.scrollHeight + 2}px`
    }
  }, [draft])

  function update(value: string) {
    const previousZone = zone
    const nextZone = counterZone(bioLength(value))

    setDraft(value)
    setServerError(null)
    setFormError(null)

    // Announce only when crossing a threshold, not on every keystroke.
    if (nextZone !== previousZone) {
      if (nextZone === 'near') announce(`Bio is close to the ${BIO_MAX_LENGTH}-character limit.`)
      if (nextZone === 'over') announce(`Bio is over the ${BIO_MAX_LENGTH}-character limit.`)
    }
  }

  function cancel() {
    setDraft(account.bio ?? '')
    setServerError(null)
    setFormError(null)
  }

  async function save() {
    if (validationError) {
      textareaRef.current?.focus()
      return
    }

    setIsSaving(true)
    setFormError(null)

    try {
      const saved = await saveAccountProfile(changes)
      onSaved(saved)
      setDraft(saved.bio ?? '')
      flashSaved()
      announce('Bio saved.')
    } catch (failure) {
      const described = describeSaveFailure(failure, ['bio'])
      setServerError(described.fieldErrors.bio ?? null)
      setFormError(described.message)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <SettingsCard
      icon={<SparkIcon />}
      title="About you"
      titleId="settings-about-title"
      description="A short bio for your profile."
      status={isDirty ? 'dirty' : isSaved ? 'saved' : 'idle'}
      footer={
        <SaveFooter
          visible={isDirty || isSaving || formError !== null}
          isSaving={isSaving}
          saveDisabled={Boolean(validationError)}
          error={formError}
          onCancel={cancel}
          onSave={() => void save()}
        />
      }
    >
      <div className="settings-field">
        <div className="settings-bio-label-row">
          <label htmlFor={BIO_ID} className="settings-label">
            Bio
            <span className="settings-optional">Optional</span>
          </label>
          <span className={`settings-counter ${zone}`} aria-hidden="true">
            {length} / {BIO_MAX_LENGTH}
          </span>
        </div>
        <textarea
          ref={textareaRef}
          id={BIO_ID}
          className="settings-input settings-bio"
          rows={4}
          value={draft}
          placeholder="Training for a half marathon, lifting three times a week…"
          onChange={(event) => update(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={`${fieldMessageId(BIO_ID)} settings-about-privacy`}
        />
        <p id={fieldMessageId(BIO_ID)} className={error ? 'settings-field-message error' : 'settings-field-message'}>
          {error ? (
            <>
              <AlertIcon size={16} />
              <span>{error}</span>
            </>
          ) : (
            <span className="sr-only">
              {length} of {BIO_MAX_LENGTH} characters used.
            </span>
          )}
        </p>
      </div>

      <p id="settings-about-privacy" className="settings-note">
        <LockIcon size={16} />
        <span>Your bio isn’t shared with FitAI Coach.</span>
      </p>
    </SettingsCard>
  )
}

export default AboutYouCard
