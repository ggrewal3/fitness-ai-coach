import { useEffect, useState } from 'react'
import { saveAccountProfile, type Account } from '../../services/account'
import { fieldMessageId, settingsFieldId } from '../../features/settings/fieldIds'
import {
  personalInfoChanges,
  personalInfoFromAccount,
  validatePersonalInfo,
  type FieldErrors,
  type PersonalInfoDraft,
  type PersonalInfoField,
} from '../../features/settings/profileDraft'
import { describeSaveFailure, focusFirstError, useSavedFlash } from '../../features/settings/saveFeedback'
import { LockIcon, UserIcon } from '../ui/icons'
import CountryCombobox from './CountryCombobox'
import SettingsCard, { SaveFooter } from './SettingsCard'
import SettingsField from './SettingsField'

type PersonalInfoCardProps = {
  account: Account
  onSaved: (account: Account) => void
  onDirtyChange: (isDirty: boolean) => void
  announce: (message: string) => void
}

const FIELDS: readonly PersonalInfoField[] = ['firstName', 'lastName', 'phone', 'countryCode']
const fieldId = (field: string) => settingsFieldId('personal', field)

function PersonalInfoCard({ account, onSaved, onDirtyChange, announce }: PersonalInfoCardProps) {
  const [draft, setDraft] = useState<PersonalInfoDraft>(() => personalInfoFromAccount(account))
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [phoneNote, setPhoneNote] = useState<string | null>(null)
  const [isSaved, flashSaved] = useSavedFlash()

  const changes = personalInfoChanges(draft, account)
  const isDirty = Object.keys(changes).length > 0

  useEffect(() => {
    onDirtyChange(isDirty)
  }, [isDirty, onDirtyChange])

  function update<K extends PersonalInfoField>(field: K, value: PersonalInfoDraft[K]) {
    const next = { ...draft, [field]: value }
    setDraft(next)
    setFormError(null)

    if (field === 'phone') {
      setPhoneNote(null)
    }

    // Re-check a field that is already showing an error so it clears as soon as it's fixed.
    if (errors[field]) {
      const fieldError = validatePersonalInfo(next)[field]
      setErrors((current) => {
        const updated = { ...current }
        if (fieldError) updated[field] = fieldError
        else delete updated[field]
        return updated
      })
    }
  }

  function cancel() {
    setDraft(personalInfoFromAccount(account))
    setErrors({})
    setFormError(null)
  }

  async function save() {
    const validation = validatePersonalInfo(draft)

    if (Object.keys(validation).length > 0) {
      setErrors(validation)
      setFormError(null)
      announce('Personal information has errors. Fix the highlighted fields.')
      focusFirstError(validation, FIELDS, fieldId)
      return
    }

    setIsSaving(true)
    setFormError(null)

    try {
      const saved = await saveAccountProfile(changes)
      onSaved(saved)
      setDraft(personalInfoFromAccount(saved))
      setErrors({})

      // Tell the user when the server stored the phone number differently from how they typed it.
      const typedPhone = changes.phone
      setPhoneNote(
        typeof typedPhone === 'string' && saved.phone && saved.phone !== typedPhone
          ? `Saved as ${saved.phone}`
          : null,
      )

      flashSaved()
      announce('Personal information saved.')
    } catch (error) {
      const failure = describeSaveFailure(error, FIELDS)
      setErrors(failure.fieldErrors)
      setFormError(failure.message)
      focusFirstError(failure.fieldErrors, FIELDS, fieldId)
    } finally {
      setIsSaving(false)
    }
  }

  const describedBy = (field: string) => fieldMessageId(fieldId(field))
  const emailId = fieldId('email')

  return (
    <SettingsCard
      icon={<UserIcon />}
      title="Personal information"
      titleId="settings-personal-title"
      description="Your name and contact details."
      status={isDirty ? 'dirty' : isSaved ? 'saved' : 'idle'}
      footer={
        <SaveFooter
          visible={isDirty || isSaving || formError !== null}
          isSaving={isSaving}
          error={formError}
          onCancel={cancel}
          onSave={() => void save()}
        />
      }
    >
      <div className="settings-field-grid">
        <SettingsField id={fieldId('firstName')} label="First name" error={errors.firstName}>
          <input
            id={fieldId('firstName')}
            className="settings-input"
            type="text"
            autoComplete="given-name"
            value={draft.firstName}
            onChange={(event) => update('firstName', event.target.value)}
            aria-invalid={errors.firstName ? true : undefined}
            aria-describedby={describedBy('firstName')}
          />
        </SettingsField>

        <SettingsField id={fieldId('lastName')} label="Last name" error={errors.lastName}>
          <input
            id={fieldId('lastName')}
            className="settings-input"
            type="text"
            autoComplete="family-name"
            value={draft.lastName}
            onChange={(event) => update('lastName', event.target.value)}
            aria-invalid={errors.lastName ? true : undefined}
            aria-describedby={describedBy('lastName')}
          />
        </SettingsField>

        <SettingsField
          id={emailId}
          className="settings-field-wide"
          label="Sign-in email"
          hint="Used to sign in. Your email can’t be changed yet."
        >
          <div className="settings-input-locked">
            <input
              id={emailId}
              className="settings-input"
              type="email"
              value={account.email}
              readOnly
              aria-describedby={fieldMessageId(emailId)}
            />
            <LockIcon size={18} className="settings-input-lock" />
          </div>
        </SettingsField>

        <SettingsField
          id={fieldId('phone')}
          label="Phone"
          optional
          hint="Include your country code, e.g. +44 20 7946 0958."
          error={errors.phone}
          note={phoneNote}
        >
          <input
            id={fieldId('phone')}
            className="settings-input"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="+1 415 555 0100"
            value={draft.phone}
            onChange={(event) => update('phone', event.target.value)}
            aria-invalid={errors.phone ? true : undefined}
            aria-describedby={describedBy('phone')}
          />
        </SettingsField>

        <SettingsField
          id={fieldId('countryCode')}
          label="Country"
          optional
          hint="Doesn’t change your units."
          error={errors.countryCode}
        >
          <CountryCombobox
            id={fieldId('countryCode')}
            value={draft.countryCode}
            onChange={(code) => update('countryCode', code)}
            describedBy={describedBy('countryCode')}
            invalid={Boolean(errors.countryCode)}
          />
        </SettingsField>
      </div>
    </SettingsCard>
  )
}

export default PersonalInfoCard
