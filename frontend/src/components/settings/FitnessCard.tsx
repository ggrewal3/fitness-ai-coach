import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { saveFitnessProfile, type FitnessGoal, type FitnessProfile } from '../../services/fitnessProfile'
import { fieldMessageId, settingsFieldId } from '../../features/settings/fieldIds'
import {
  ACTIVITY_OPTIONS,
  DIET_OPTIONS,
  GOAL_OPTIONS,
  ageFromDateOfBirth,
  dateOfBirthBounds,
  fitnessChanges,
  fitnessDraftFromProfile,
  fitnessErrorKey,
  sameFitnessUnits,
  targetWeightHint,
  targetWeightRange,
  updateFitnessDraft,
  validateFitness,
  type FitnessDraft,
  type FitnessDraftField,
  type FitnessUnits,
} from '../../features/settings/fitnessDraft'
import { bodyWeightUnitLabel, heightUnitLabel } from '../../features/units/unitFormat'
import type { FieldErrors } from '../../features/settings/profileDraft'
import { describeSaveFailure, focusFirstError, useSavedFlash } from '../../features/settings/saveFeedback'
import ChoiceGroup, { type ChoiceOption } from '../ui/ChoiceGroup'
import { AlertIcon, BalanceIcon, DumbbellIcon, FlameIcon, InfoIcon } from '../ui/icons'
import HeightField from './HeightField'
import SettingsCard, { SaveFooter } from './SettingsCard'
import SettingsField from './SettingsField'

type FitnessCardProps = {
  profile: FitnessProfile | null
  /** The user's current preferred units. */
  units: FitnessUnits
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

/** "target weight in kg and height in cm": the draft's units that differ from the preference. */
function staleUnitsText(draftUnits: FitnessUnits, units: FitnessUnits): string {
  const parts: string[] = []
  if (draftUnits.bodyWeightUnit !== units.bodyWeightUnit) {
    parts.push(`target weight in ${bodyWeightUnitLabel(draftUnits.bodyWeightUnit)}`)
  }
  if (draftUnits.heightUnit !== units.heightUnit) parts.push(`height in ${heightUnitLabel(draftUnits.heightUnit)}`)
  return parts.join(' and ')
}

function FitnessCard({ profile, units, onSaved, onDirtyChange, announce }: FitnessCardProps) {
  const [storedDraft, setDraft] = useState<FitnessDraft>(() => fitnessDraftFromProfile(profile, units))
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isSaved, flashSaved] = useSavedFlash()
  const bounds = useMemo(() => dateOfBirthBounds(), [])

  // A clean draft always follows the current units (rebuilt from the saved
  // profile, so it stays clean). A dirty draft keeps the units it was typed in
  // until Save or Cancel, so nothing the user typed is converted underneath them.
  const isStoredDirty = Object.keys(fitnessChanges(storedDraft, profile)).length > 0
  const draft =
    isStoredDirty || sameFitnessUnits(storedDraft.units, units)
      ? storedDraft
      : fitnessDraftFromProfile(profile, units)
  const changes = fitnessChanges(draft, profile)
  const isDirty = Object.keys(changes).length > 0
  const staleUnits = sameFitnessUnits(draft.units, units) ? '' : staleUnitsText(draft.units, units)
  const weightRange = targetWeightRange(draft.units.bodyWeightUnit)
  const age = ageFromDateOfBirth(draft.dateOfBirth)
  const hasProfile = profile !== null

  useEffect(() => {
    onDirtyChange(isDirty)
  }, [isDirty, onDirtyChange])

  function update<K extends FitnessDraftField>(field: K, value: FitnessDraft[K]) {
    const next = updateFitnessDraft(draft, field, value)
    const errorKey = fitnessErrorKey(field)
    setDraft(next)
    setFormError(null)

    if (errors[errorKey]) {
      const fieldError = validateFitness(next)[errorKey]
      setErrors((current) => {
        const updated = { ...current }
        if (fieldError) updated[errorKey] = fieldError
        else delete updated[errorKey]
        return updated
      })
    }
  }

  // Save and Cancel adopt the current preferred units.
  function cancel() {
    setDraft(fitnessDraftFromProfile(profile, units))
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
      setDraft(fitnessDraftFromProfile(saved, units))
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

      {staleUnits && (
        <p className="settings-note">
          <InfoIcon size={18} />
          <span>Showing {staleUnits} until you save or cancel.</span>
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

        <HeightField
          id={fieldId('heightCm')}
          unit={draft.units.heightUnit}
          draft={draft}
          error={errors.heightCm}
          onChange={update}
        />

        <SettingsField
          id={fieldId('targetWeightKg')}
          label="Target weight"
          hint={targetWeightHint(draft.units.bodyWeightUnit)}
          error={errors.targetWeightKg}
        >
          <div className="settings-input-suffix">
            <input
              id={fieldId('targetWeightKg')}
              className="settings-input"
              type="number"
              inputMode="decimal"
              step="0.1"
              min={weightRange.min}
              max={weightRange.max}
              value={draft.targetWeight}
              onChange={(event) => update('targetWeight', event.target.value)}
              aria-invalid={errors.targetWeightKg ? true : undefined}
              aria-describedby={describedBy('targetWeightKg')}
            />
            <span aria-hidden="true">{bodyWeightUnitLabel(draft.units.bodyWeightUnit)}</span>
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
