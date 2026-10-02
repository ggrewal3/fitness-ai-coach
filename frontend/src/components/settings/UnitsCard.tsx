import { useEffect, useRef, useState } from 'react'
import { saveUnitPreferences, type UnitPreferences } from '../../services/account'
import SegmentedControl from '../ui/SegmentedControl'
import { AlertIcon, CheckIcon, InfoIcon, RulerIcon } from '../ui/icons'
import SettingsCard from './SettingsCard'

type UnitsCardProps = {
  preferences: UnitPreferences
  /** Receives only the confirmed field, so out-of-order responses can't reset other rows. */
  onSaved: (preferences: Partial<UnitPreferences>) => void
  announce: (message: string) => void
}

type UnitField = keyof UnitPreferences
type RowStatus = 'saved' | 'error'

const ROWS: {
  field: UnitField
  label: string
  description: string
  options: { value: string; label: string }[]
}[] = [
  {
    field: 'bodyWeightUnit',
    label: 'Body weight',
    description: 'Weight check-ins and target weight.',
    options: [
      { value: 'KG', label: 'kg' },
      { value: 'LB', label: 'lb' },
    ],
  },
  {
    field: 'workoutLoadUnit',
    label: 'Workout load',
    description: 'New exercises start in your preferred unit. Existing workout sets stay exactly as logged.',
    options: [
      { value: 'KG', label: 'kg' },
      { value: 'LB', label: 'lb' },
    ],
  },
  {
    field: 'heightUnit',
    label: 'Height',
    description: 'How your height is shown and entered.',
    options: [
      { value: 'CM', label: 'cm' },
      { value: 'FT_IN', label: 'ft · in' },
    ],
  },
]

const STATUS_CLEAR_MS = 3000

// Unit preferences save immediately (optimistic, rolled back on failure).
// They are display/input preferences only: no stored data is converted.
function UnitsCard({ preferences, onSaved, announce }: UnitsCardProps) {
  const [values, setValues] = useState<UnitPreferences>(preferences)
  const [pending, setPending] = useState<ReadonlySet<UnitField>>(new Set())
  const [status, setStatus] = useState<Partial<Record<UnitField, RowStatus>>>({})
  const timers = useRef<Partial<Record<UnitField, number>>>({})

  useEffect(() => {
    const active = timers.current
    return () => Object.values(active).forEach((timer) => window.clearTimeout(timer))
  }, [])

  function setRowStatus(field: UnitField, next: RowStatus | undefined) {
    window.clearTimeout(timers.current[field])
    setStatus((current) => ({ ...current, [field]: next }))

    if (next === 'saved') {
      timers.current[field] = window.setTimeout(
        () => setStatus((current) => ({ ...current, [field]: undefined })),
        STATUS_CLEAR_MS,
      )
    }
  }

  async function change(field: UnitField, value: string) {
    const previous = values[field]
    const row = ROWS.find((item) => item.field === field)
    const optionLabel = row?.options.find((option) => option.value === value)?.label ?? value

    setValues((current) => ({ ...current, [field]: value }) as UnitPreferences)
    setPending((current) => new Set(current).add(field))
    setRowStatus(field, undefined)

    try {
      const saved = await saveUnitPreferences({ [field]: value } as Partial<UnitPreferences>)
      setValues((current) => ({ ...current, [field]: saved[field] }))
      onSaved({ [field]: saved[field] })
      setRowStatus(field, 'saved')
      announce(`${row?.label ?? 'Unit'} set to ${optionLabel}.`)
    } catch {
      setValues((current) => ({ ...current, [field]: previous }))
      setRowStatus(field, 'error')
      announce(`${row?.label ?? 'Unit'} couldn’t be saved. Your previous choice was kept.`)
    } finally {
      setPending((current) => {
        const next = new Set(current)
        next.delete(field)
        return next
      })
    }
  }

  return (
    <SettingsCard
      icon={<RulerIcon />}
      title="Units"
      titleId="settings-units-title"
      description="Your preferred units are used across FitAI."
    >
      <div className="settings-unit-rows">
        {ROWS.map((row) => {
          const descriptionId = `settings-unit-${row.field}-desc`
          const rowStatus = status[row.field]

          return (
            <div key={row.field} className="settings-unit-row">
              <div className="settings-unit-text">
                <p className="settings-unit-label" aria-hidden="true">
                  {row.label}
                </p>
                <p id={descriptionId} className="settings-unit-description">
                  {row.description}
                </p>
                <p className={`settings-unit-status ${rowStatus ?? ''}`} aria-hidden="true">
                  {rowStatus === 'saved' && (
                    <>
                      <CheckIcon size={14} /> Saved
                    </>
                  )}
                  {rowStatus === 'error' && (
                    <>
                      <AlertIcon size={14} /> Couldn’t save. Try again.
                    </>
                  )}
                </p>
              </div>
              <SegmentedControl
                name={`unit-${row.field}`}
                legend={row.label}
                hideLegend
                value={values[row.field]}
                options={row.options}
                onChange={(value) => void change(row.field, value)}
                disabled={pending.has(row.field)}
                describedBy={descriptionId}
              />
            </div>
          )
        })}
      </div>

      <p className="settings-note">
        <InfoIcon size={16} />
        <span>Changing a unit never rewrites your saved history. Existing entries stay exactly as logged.</span>
      </p>
    </SettingsCard>
  )
}

export default UnitsCard
