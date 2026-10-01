import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { saveFitnessProfile, type FitnessGoal, type FitnessProfile } from '../../services/fitnessProfile'
import { fieldMessageId, settingsFieldId } from '../../features/settings/fieldIds'
import {
  ACTIVITY_OPTIONS,
  DIET_OPTIONS,
  GOAL_OPTIONS,
  HEIGHT_CM_MAX,
  HEIGHT_CM_MIN,
  TARGET_WEIGHT_KG_MAX,
  TARGET_WEIGHT_KG_MIN,
  ageFromDateOfBirth,
  dateOfBirthBounds,
  fitnessChanges,
  fitnessDraftFromProfile,
  validateFitness,
  type FitnessDraft,
} from '../../features/settings/fitnessDraft'
import type { FieldErrors } from '../../features/settings/profileDraft'
import { describeSaveFailure, focusFirstError, useSavedFlash } from '../../features/settings/saveFeedback'
import ChoiceGroup, { type ChoiceOption } from '../ui/ChoiceGroup'
import { AlertIcon, BalanceIcon, DumbbellIcon, FlameIcon, InfoIcon } from '../ui/icons'
import SettingsCard, { SaveFooter } from './SettingsCard'
import SettingsField from './SettingsField'

type FitnessCardProps = {
  profile: FitnessProfile | null
  onSaved: (profile: FitnessProfile) => void
  onDirtyChange: (isDirty: boolean) => void
  announce: (message: string) => void
}

const FIELDS = ['dateOfBirth', 'heightCm', 'targetWeightKg', 'goal', 'activityLevel', 'dietPreference'] as const
const fieldId = (field: string) => settingsFieldId('fitness', field)

const GOAL_ICONS: Record<FitnessGoal, ReactNode> = {
  LOSE_FAT: <FlameIcon />,
  MAINTAIN: <BalanceIcon />,
  GAIN_MUSCLE: <DumbbellIcon />,
}

function LevelMeter({ level }: { level: number }) {
  return (
    <span className="level-meter" aria-hidden="true">
      {[1, 2, 3, 4, 5].map((step) => (
        <span key={step} className={step <= level ? 'level-meter-bar filled' : 'level-meter-bar'} />
      ))}
    </span>
  )
}

const goalChoices: ChoiceOption<FitnessGoal>[] = GOAL_OPTIONS.map((option) => ({
  ...option,
  visual: <span className="choice-icon-tile">{GOAL_ICONS[option.value]}</span>,
}))

const activityChoices = ACTIVITY_OPTIONS.map((option) => ({
  value: option.value,
  label: option.label,
  description: option.description,
  visual: <LevelMeter level={option.level} />,
}))

function FitnessCard({ profile, onSaved, onDirtyChange, announce }: FitnessCardProps) {
  const [draft, setDraft] = useState<FitnessDraft>(() => fitnessDraftFromProfile(profile))
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isSaved, flashSaved] = useSavedFlash()
  const bounds = useMemo(() => dateOfBirthBounds(), [])

  const changes = fitnessChanges(draft, profile)
  const isDirty = Object.keys(changes).length > 0
  const age = ageFromDateOfBirth(draft.dateOfBirth)
  const hasProfile = profile !== null

  useEffect(() => {
    onDirtyChange(isDirty)
  }, [isDirty, onDirtyChange])

  function update<K extends keyof FitnessDraft>(field: K, value: FitnessDraft[K]) {
    const next = { ...draft, [field]: value }
    setDraft(next)
    setFormError(null)

    if (errors[field]) {
      const fieldError = validateFitness(next)[field]
      setErrors((current) => {
        const updated = { ...current }
        if (fieldError) updated[field] = fieldError
        else delete updated[field]
        return updated
      })
    }
  }

  function cancel() {
    setDraft(fitnessDraftFromProfile(profile))
    setErrors({})
    setFormError(null)
  }

  async function save() {
    const validation = validateFitness(draft)

    if (Object.keys(validation).length > 0) {
      setErrors(validation)
      announce('Fitness profile has errors. Fix the highlighted fields.')
      focusFirstError(validation, FIELDS, fieldId)
      return
    }

    setIsSaving(true)
    setFormError(null)

    try {
      // Only changed fields are sent; the first save creates the profile.
      const saved = await saveFitnessProfile(hasProfile, changes)
      onSaved(saved)
      setDraft(fitnessDraftFromProfile(saved))
      setErrors({})
      flashSaved()
      announce(hasProfile ? 'Fitness profile saved.' : 'Fitness profile created.')
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

  return (
    <SettingsCard
      icon={<DumbbellIcon />}
      title="Fitness profile"
      titleId="settings-fitness-title"
      description="Helps FitAI Coach tailor its advice to you."
      status={isDirty ? 'dirty' : isSaved ? 'saved' : 'idle'}
      footer={
        <SaveFooter
          visible={isDirty || isSaving || formError !== null}
          isSaving={isSaving}
          saveLabel={hasProfile ? 'Save changes' : 'Create profile'}
          error={formError}
          onCancel={cancel}
          onSave={() => void save()}
        />
      }
    >
      {!hasProfile && (
        <p className="settings-note settings-note-primary">
          <InfoIcon size={18} />
          <span>Add a few details so FitAI Coach can personalize its advice. Every field is optional.</span>
        </p>
      )}

      <div className="settings-field-grid settings-field-grid-3">
        <SettingsField
          id={fieldId('dateOfBirth')}
          label="Date of birth"
          hint={age !== null ? `Age ${age}` : 'Used to calculate your age.'}
          error={errors.dateOfBirth}
        >
          <input
            id={fieldId('dateOfBirth')}
            className="settings-input"
            type="date"
            autoComplete="bday"
            min={bounds.min}
            max={bounds.max}
            value={draft.dateOfBirth}
            onChange={(event) => update('dateOfBirth', event.target.value)}
            aria-invalid={errors.dateOfBirth ? true : undefined}
            aria-describedby={describedBy('dateOfBirth')}
          />
        </SettingsField>

        <SettingsField id={fieldId('heightCm')} label="Height" hint={`${HEIGHT_CM_MIN}–${HEIGHT_CM_MAX} cm`} error={errors.heightCm}>
          <div className="settings-input-suffix">
            <input
              id={fieldId('heightCm')}
              className="settings-input"
              type="number"
              inputMode="decimal"
              step="0.1"
              min={HEIGHT_CM_MIN}
              max={HEIGHT_CM_MAX}
              value={draft.heightCm}
              onChange={(event) => update('heightCm', event.target.value)}
              aria-invalid={errors.heightCm ? true : undefined}
              aria-describedby={describedBy('heightCm')}
            />
            <span aria-hidden="true">cm</span>
          </div>
        </SettingsField>

        <SettingsField
          id={fieldId('targetWeightKg')}
          label="Target weight"
          hint={`${TARGET_WEIGHT_KG_MIN}–${TARGET_WEIGHT_KG_MAX} kg`}
          error={errors.targetWeightKg}
        >
          <div className="settings-input-suffix">
            <input
              id={fieldId('targetWeightKg')}
              className="settings-input"
              type="number"
              inputMode="decimal"
              step="0.1"
              min={TARGET_WEIGHT_KG_MIN}
              max={TARGET_WEIGHT_KG_MAX}
              value={draft.targetWeightKg}
              onChange={(event) => update('targetWeightKg', event.target.value)}
              aria-invalid={errors.targetWeightKg ? true : undefined}
              aria-describedby={describedBy('targetWeightKg')}
            />
            <span aria-hidden="true">kg</span>
          </div>
        </SettingsField>
      </div>

      <ChoiceGroup
        name="fitness-goal"
        legend="Goal"
        idPrefix={fieldId('goal')}
        variant="card"
        value={draft.goal}
        options={goalChoices}
        onChange={(value) => update('goal', value)}
      />

      <ChoiceGroup
        name="fitness-activity"
        legend="Activity level"
        hint="Your typical week, including work and exercise."
        idPrefix={fieldId('activityLevel')}
        variant="row"
        value={draft.activityLevel}
        options={activityChoices}
        onChange={(value) => update('activityLevel', value)}
      />

      <ChoiceGroup
        name="fitness-diet"
        legend="Diet preference"
        idPrefix={fieldId('dietPreference')}
        variant="chip"
        value={draft.dietPreference}
        options={DIET_OPTIONS}
        onChange={(value) => update('dietPreference', value)}
      />

      {(errors.goal || errors.activityLevel || errors.dietPreference) && (
        <p className="settings-field-message error" role="alert">
          <AlertIcon size={16} />
          <span>{errors.goal ?? errors.activityLevel ?? errors.dietPreference}</span>
        </p>
      )}

      <div className="settings-coach-panel">
        <p className="settings-coach-title">What FitAI Coach sees</p>
        <p className="settings-coach-text">
          Your age (worked out from your date of birth), height, target weight, goal, activity level and diet
          preference. Your bio and contact details aren’t shared.
        </p>
      </div>
    </SettingsCard>
  )
}

type FitnessErrorCardProps = {
  isRetrying: boolean
  onRetry: () => void
}

export function FitnessErrorCard({ isRetrying, onRetry }: FitnessErrorCardProps) {
  return (
    <SettingsCard
      icon={<DumbbellIcon />}
      title="Fitness profile"
      titleId="settings-fitness-title"
      description="Helps FitAI Coach tailor its advice to you."
    >
      <div className="settings-inline-error" role="alert">
        <AlertIcon size={20} />
        <div>
          <p className="settings-inline-error-title">Your fitness profile couldn’t be loaded.</p>
          <p>The rest of Settings still works.</p>
        </div>
        <button type="button" className="dashboard-secondary-button" onClick={onRetry} disabled={isRetrying}>
          {isRetrying ? 'Retrying…' : 'Retry'}
        </button>
      </div>
    </SettingsCard>
  )
}

export default FitnessCard
