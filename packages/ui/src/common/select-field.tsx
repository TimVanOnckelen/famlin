import type { ComponentProps, ReactNode } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../select'
import { cn } from '../lib/utils'

type SelectFieldProps = Omit<ComponentProps<typeof SelectTrigger>, 'value' | 'onChange' | 'defaultValue'> & {
  items: readonly { value: string | number; label: ReactNode }[]
  value: string | number
  onValueChange: (value: string) => void
  required?: boolean
  name?: string
}

export function SelectField({
  items,
  value,
  onValueChange,
  required,
  name,
  disabled,
  className,
  ...props
}: SelectFieldProps) {
  const options = items.map((item) => ({ ...item, value: String(item.value) }))
  return (
    <Select
      items={options}
      value={String(value)}
      onValueChange={(nextValue) => {
        if (nextValue !== null) onValueChange(nextValue)
      }}
      required={required}
      name={name}
      disabled={disabled}
    >
      <SelectTrigger className={cn('w-full min-w-0', className)} {...props}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="start" alignItemWithTrigger={false}>
        {options.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
