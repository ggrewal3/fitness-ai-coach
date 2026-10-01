type SegmentedOption<T extends string> = { value: T; label: string }

type SegmentedControlProps<T extends string> = {
  name: string
  /** Accessible name of the group (visually hidden when `hideLegend`). */
  legend: string
  hideLegend?: boolean
  value: T
  options: readonly SegmentedOption<T>[]
  onChange: (value: T) => void
  disabled?: boolean
  describedBy?: string
}

// A single-choice pill built on native radio inputs: arrow keys, labels and
// screen-reader semantics come from the platform.
function SegmentedControl<T extends string>({
  name,
  legend,
  hideLegend = false,
  value,
  options,
  onChange,
  disabled = false,
  describedBy,
}: SegmentedControlProps<T>) {
  return (
    <fieldset className="segmented" disabled={disabled} aria-describedby={describedBy}>
      <legend className={hideLegend ? 'sr-only' : 'segmented-legend'}>{legend}</legend>
      <div className="segmented-track">
        {options.map((option) => (
          <label key={option.value} className="segmented-option">
            <input
              className="sr-only"
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            <span className="segmented-label">{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

export default SegmentedControl
