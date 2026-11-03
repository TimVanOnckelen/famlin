import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type CSSProperties } from 'react'
import { Icon } from './Icon'
import './CustomSelect.css'

export function CustomSelect<T extends string>({
  value,
  options,
  label,
  onChange,
}: {
  value: T
  options: { value: T; label: string; description?: string; icon?: ReactNode; iconStyle?: CSSProperties }[]
  label: string
  onChange: (value: T) => void
}) {
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const selected = options.find((option) => option.value === value) ?? options[0]
  const activeIndex = Math.min(active, options.length - 1)
  useEffect(() => {
    if (open) document.getElementById(`${id}-option-${activeIndex}`)?.scrollIntoView?.({ block: 'nearest' })
  }, [open, activeIndex, id])
  if (!selected) return null
  const selectedIndex = options.indexOf(selected)

  function show() {
    setActive(selectedIndex)
    setOpen(true)
  }
  function choose(index: number) {
    onChange(options[index].value)
    setOpen(false)
    trigger.current?.focus()
  }
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault()
      setOpen(true)
      setActive(
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? options.length - 1
            : !open
              ? selectedIndex
              : (activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
      )
    } else if (open && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault()
      choose(activeIndex)
    }
  }
  function content(option: typeof selected) {
    return (
      <>
        {option.icon && (
          <span className="custom-select-icon" style={option.iconStyle}>
            {option.icon}
          </span>
        )}
        <span className="custom-select-copy">
          <span className="custom-select-name">{option.label}</span>
          {option.description && <span className="custom-select-description">{option.description}</span>}
        </span>
      </>
    )
  }
  return (
    <div
      className="custom-select-select"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
      }}
      onKeyDownCapture={(event) => {
        // Handle Escape before the containing modal's native key listener.
        if (open && event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          setOpen(false)
        }
      }}
    >
      <span id={`${id}-label`} className="field-label">
        {label}
      </span>
      <button
        ref={trigger}
        type="button"
        role="combobox"
        aria-labelledby={`${id}-label`}
        aria-expanded={open}
        aria-controls={`${id}-options`}
        aria-haspopup="listbox"
        aria-activedescendant={open ? `${id}-option-${activeIndex}` : undefined}
        className="custom-select-trigger"
        onKeyDown={onKeyDown}
        onClick={() => (open ? setOpen(false) : show())}
      >
        {content(selected)}
        <Icon name="chevron-down" size={18} />
      </button>
      {open && (
        <div id={`${id}-options`} role="listbox" aria-labelledby={`${id}-label`} className="custom-select-options">
          {options.map((option, index) => (
            <button
              key={option.value}
              id={`${id}-option-${index}`}
              type="button"
              role="option"
              aria-label={option.label}
              aria-describedby={option.description ? `${id}-description-${index}` : undefined}
              aria-selected={option.value === value}
              tabIndex={-1}
              className={`custom-select-option${index === activeIndex ? ' is-active' : ''}`}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(index)}
            >
              {option.icon && (
                <span className="custom-select-icon" style={option.iconStyle}>
                  {option.icon}
                </span>
              )}
              <span className="custom-select-copy">
                <span className="custom-select-name">{option.label}</span>
                {option.description && (
                  <span id={`${id}-description-${index}`} className="custom-select-description">
                    {option.description}
                  </span>
                )}
              </span>
              {option.value === value && <Icon name="check" size={18} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
