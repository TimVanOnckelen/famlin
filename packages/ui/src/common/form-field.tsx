import type { ReactNode } from 'react'
import { cn } from '../lib/utils'
import { Label } from '../label'

interface FormFieldProps {
  label: string
  children: ReactNode
  hint?: ReactNode
  error?: ReactNode
  htmlFor?: string
  className?: string
}

export function FormField({ label, children, hint, error, htmlFor, className }: FormFieldProps) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <Label htmlFor={htmlFor} className="self-start text-sm font-bold">
        {label}
      </Label>
      {children}
      {hint && <p className="text-xs font-medium text-muted-foreground">{hint}</p>}
      {error && <p className="text-sm font-medium text-destructive">{error}</p>}
    </div>
  )
}

export function FormRow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex flex-col gap-4 sm:flex-row sm:items-end', className)}>{children}</div>
}
