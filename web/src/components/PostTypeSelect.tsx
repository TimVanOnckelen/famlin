import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { Icon, type IconName } from './Icon'
import './PostTypeSelect.css'

export function PostTypeSelect<T extends string>({
  value,
  options,
  label,
  onChange,
}: {
  value: T
  options: { value: T; label: string; description: string; icon: IconName }[]
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
        <span className="post-type-icon">
          <Icon name={option.icon} size={20} />
        </span>
        <span className="post-type-copy">
          <span className="post-type-name">{option.label}</span>
          <span className="post-type-description">{option.description}</span>
        </span>
      </>
    )
  }
  return (
    <div
      className="post-type-select"
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
        className="post-type-trigger"
        onKeyDown={onKeyDown}
        onClick={() => (open ? setOpen(false) : show())}
      >
        {content(selected)}
        <Icon name="chevron-down" size={18} />
      </button>
      {open && (
        <div id={`${id}-options`} role="listbox" aria-labelledby={`${id}-label`} className="post-type-options">
          {options.map((option, index) => (
            <button
              key={option.value}
              id={`${id}-option-${index}`}
              type="button"
              role="option"
              aria-label={option.label}
              aria-describedby={`${id}-description-${index}`}
              aria-selected={option.value === value}
              tabIndex={-1}
              className={`post-type-option${index === activeIndex ? ' is-active' : ''}`}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(index)}
            >
              <span className="post-type-icon">
                <Icon name={option.icon} size={20} />
              </span>
              <span className="post-type-copy">
                <span className="post-type-name">{option.label}</span>
                <span id={`${id}-description-${index}`} className="post-type-description">
                  {option.description}
                </span>
              </span>
              {option.value === value && <Icon name="check" size={18} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
