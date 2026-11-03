import type { InputHTMLAttributes } from 'react'
import './Switch.css'

export function Switch({
  checked,
  onCheckedChange,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'role' | 'checked' | 'onChange' | 'className'> & {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <input
      {...props}
      type="checkbox"
      role="switch"
      className="fam-switch"
      checked={checked}
      onChange={(event) => onCheckedChange(event.target.checked)}
    />
  )
}
