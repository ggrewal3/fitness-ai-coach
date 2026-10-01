import type { ReactNode } from 'react'
import { CheckIcon } from './icons'

export type ChoiceOption<T extends string> = {
  value: T
  label: string
  description?: string
  /** Visual accent shown before the label (icon tile, level meter, ...). */
  visual?: ReactNode
}

type ChoiceGroupProps<T extends string> = {
  name: string
  legend: string
  /** Optional helper shown under the legend and linked to the group. */
  hint?: string
  value: T | null
  options: readonly ChoiceOption<T>[]
  onChange: (value: T) => void
  /** card: tiles in a grid · row: full-width descriptive rows · chip: wrapping pills */
  variant: 'card' | 'row' | 'chip'
  idPrefix: string
}

// Visual single-choice controls backed by native radio inputs, so arrow-key
// navigation, labelling and screen-reader semantics come from the platform.
function ChoiceGroup<T extends string>({
  name,
  legend,
  hint,
  value,
  options,
  onChange,
  variant,
  idPrefix,
}: ChoiceGroupProps<T>) {
  const hintId = hint ? `${idPrefix}-hint` : undefined

  return (
    <fieldset className={`choice-group choice-group-${variant}`} aria-describedby={hintId}>
      <legend className="choice-legend">{legend}</legend>
      {hint && (
        <p id={hintId} className="choice-hint">
          {hint}
        </p>
      )}
      <div className="choice-options">
        {options.map((option) => {
          const descriptionId = option.description ? `${idPrefix}-${option.value}-desc` : undefined

          return (
            <label key={option.value} className="choice-option">
              <input
                className="sr-only"
                type="radio"
                name={name}
                value={option.value}
                checked={value === option.value}
                onChange={() => onChange(option.value)}
                aria-describedby={descriptionId}
              />
              {option.visual && <span className="choice-visual">{option.visual}</span>}
              <span className="choice-text">
                <span className="choice-label">{option.label}</span>
                {option.description && (
                  <span id={descriptionId} className="choice-description">
                    {option.description}
                  </span>
                )}
              </span>
              <span className="choice-check" aria-hidden="true">
                <CheckIcon size={14} />
              </span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

export default ChoiceGroup
