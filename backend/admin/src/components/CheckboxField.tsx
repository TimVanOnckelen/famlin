import { useId, type ReactNode } from 'react'
import { Checkbox } from '@famlin/ui/checkbox'

export function CheckboxField({
  label,
  hint,
  checked,
  onChange,
}: {
  label: ReactNode
  hint?: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  const hintId = useId()
  return (
    <div className="checkbox-field">
      <label className="checkbox-row">
        <Checkbox checked={checked} onCheckedChange={onChange} aria-describedby={hint ? hintId : undefined} />
        <span>{label}</span>
      </label>
      {hint && (
        <p id={hintId} className="checkbox-help">
          {hint}
        </p>
      )}
    </div>
  )
}
