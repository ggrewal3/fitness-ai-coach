import { fieldMessageId } from '../../features/settings/fieldIds'
import {
  HEIGHT_CM_MAX,
  HEIGHT_CM_MIN,
  heightHint,
  type FitnessDraft,
  type FitnessDraftField,
} from '../../features/settings/fitnessDraft'
import type { HeightUnit } from '../../features/units/units'
import SettingsField from './SettingsField'

type HeightFieldProps = {
  /** id of the first input (the cm input, or feet), used for error focus. */
  id: string
  unit: HeightUnit
  draft: Pick<FitnessDraft, 'heightCm' | 'heightFeet' | 'heightInches'>
  error?: string
  onChange: (field: Extract<FitnessDraftField, 'heightCm' | 'heightFeet' | 'heightInches'>, value: string) => void
}

// Height in the preferred unit: one cm input, or whole feet + inches inputs
// in a labelled group sharing one helper/error line.
function HeightField({ id, unit, draft, error, onChange }: HeightFieldProps) {
  const describedBy = fieldMessageId(id)
  const invalid = error ? true : undefined

  if (unit === 'CM') {
    return (
      <SettingsField id={id} label="Height" hint={heightHint('CM')} error={error}>
        <div className="settings-input-suffix">
          <input
            id={id}
            className="settings-input"
            type="number"
            inputMode="decimal"
            step="0.1"
            min={HEIGHT_CM_MIN}
            max={HEIGHT_CM_MAX}
            value={draft.heightCm}
            onChange={(event) => onChange('heightCm', event.target.value)}
            aria-invalid={invalid}
            aria-describedby={describedBy}
          />
          <span aria-hidden="true">cm</span>
        </div>
      </SettingsField>
    )
  }

  return (
    <SettingsField id={id} label="Height" hint={heightHint('FT_IN')} error={error} group>
      <div className="settings-height-pair">
        <div className="settings-input-suffix">
          <input
            id={id}
            className="settings-input"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            maxLength={2}
            value={draft.heightFeet}
            onChange={(event) => onChange('heightFeet', event.target.value)}
            aria-label="Height, feet"
            aria-invalid={invalid}
            aria-describedby={describedBy}
          />
          <span aria-hidden="true">ft</span>
        </div>
        <div className="settings-input-suffix">
          <input
            id={`${id}-inches`}
            className="settings-input"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            maxLength={2}
            value={draft.heightInches}
            onChange={(event) => onChange('heightInches', event.target.value)}
            aria-label="Height, inches"
            aria-invalid={invalid}
            aria-describedby={describedBy}
          />
          <span aria-hidden="true">in</span>
        </div>
      </div>
    </SettingsField>
  )
}

export default HeightField
