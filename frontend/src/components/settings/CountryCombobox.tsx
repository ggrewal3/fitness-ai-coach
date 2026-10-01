import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { getCountryName, searchCountries } from '../../features/settings/countries'
import { ChevronDownIcon, CloseIcon } from '../ui/icons'

type CountryComboboxProps = {
  id: string
  value: string | null
  onChange: (code: string | null) => void
  describedBy?: string
  invalid?: boolean
}

// Searchable country picker (ARIA 1.2 combobox + listbox). Shows localized
// names from Intl.DisplayNames; stores the ISO 3166-1 alpha-2 code.
function CountryCombobox({ id, value, onChange, describedBy, invalid }: CountryComboboxProps) {
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(-1)

  const selectedName = getCountryName(value)
  const options = useMemo(() => (isOpen ? searchCountries(query) : []), [isOpen, query])
  const activeOption = activeIndex >= 0 ? options[activeIndex] : undefined

  function open(nextQuery = '') {
    const results = searchCountries(nextQuery)
    const selectedIndex = nextQuery ? 0 : results.findIndex((option) => option.code === value)

    setQuery(nextQuery)
    setIsOpen(true)
    setActiveIndex(results.length === 0 ? -1 : Math.max(0, selectedIndex))
  }

  function close() {
    setIsOpen(false)
    setQuery('')
    setActiveIndex(-1)
  }

  function select(code: string) {
    onChange(code)
    close()
  }

  function scrollOptionIntoView(index: number) {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' })
  }

  function moveActive(next: number) {
    if (options.length === 0) {
      return
    }

    const bounded = Math.max(0, Math.min(options.length - 1, next))
    setActiveIndex(bounded)
    scrollOptionIntoView(bounded)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        if (!isOpen) open()
        else moveActive(activeIndex + 1)
        break
      case 'ArrowUp':
        event.preventDefault()
        if (!isOpen) open()
        else moveActive(activeIndex - 1)
        break
      case 'Home':
        if (isOpen) {
          event.preventDefault()
          moveActive(0)
        }
        break
      case 'End':
        if (isOpen) {
          event.preventDefault()
          moveActive(options.length - 1)
        }
        break
      case 'Enter':
        if (isOpen && activeOption) {
          event.preventDefault()
          select(activeOption.code)
        }
        break
      case 'Escape':
        if (isOpen) {
          event.preventDefault()
          close()
        }
        break
      case 'Tab':
        close()
        break
    }
  }

  return (
    <div className={invalid ? 'country-combobox invalid' : 'country-combobox'}>
      <input
        ref={inputRef}
        id={id}
        className="settings-input country-combobox-input"
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={isOpen}
        aria-controls={listId}
        aria-activedescendant={isOpen && activeOption ? `${listId}-${activeOption.code}` : undefined}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        autoComplete="off"
        spellCheck={false}
        placeholder="Search countries"
        value={isOpen ? query : selectedName}
        onChange={(event) => open(event.target.value)}
        onFocus={(event) => event.target.select()}
        onClick={() => !isOpen && open()}
        onBlur={close}
        onKeyDown={handleKeyDown}
      />

      {value && !isOpen ? (
        <button
          type="button"
          className="country-combobox-clear"
          aria-label="Clear country"
          onClick={() => {
            onChange(null)
            inputRef.current?.focus()
          }}
        >
          <CloseIcon size={16} />
        </button>
      ) : (
        <span className="country-combobox-chevron" aria-hidden="true">
          <ChevronDownIcon size={18} />
        </span>
      )}

      <ul
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label="Countries"
        className="country-combobox-list"
        hidden={!isOpen}
      >
        {options.map((option, index) => (
          <li
            key={option.code}
            id={`${listId}-${option.code}`}
            data-index={index}
            role="option"
            aria-selected={option.code === value}
            className={index === activeIndex ? 'country-combobox-option active' : 'country-combobox-option'}
            // Keep focus in the input so blur doesn't close the list first.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => select(option.code)}
            onMouseMove={() => activeIndex !== index && setActiveIndex(index)}
          >
            <span className="country-combobox-name">{option.name}</span>
            <span className="country-combobox-code">{option.code}</span>
          </li>
        ))}
        {isOpen && options.length === 0 && (
          <li className="country-combobox-empty" role="presentation">
            No matching country
          </li>
        )}
      </ul>
    </div>
  )
}

export default CountryCombobox
