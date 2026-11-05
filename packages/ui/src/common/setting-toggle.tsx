import { useId } from 'react'
import { Label } from '../label'
import { Switch } from '../switch'

interface SettingToggleProps {
  title: string
  hint: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
}

export function SettingToggle({ title, hint, checked, onCheckedChange, disabled }: SettingToggleProps) {
  const id = useId()
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <Label htmlFor={id} className="text-sm font-bold">
          {title}
        </Label>
        <p className="mt-1 text-xs font-medium text-muted-foreground">{hint}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </div>
  )
}
