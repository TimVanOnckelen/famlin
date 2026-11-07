import type { ComponentProps } from 'react'
import { LoaderCircle } from 'lucide-react'
import { cn } from '../lib/utils'

export function StateMessage({
  children,
  variant = 'empty',
  className,
  ...props
}: {
  variant?: 'loading' | 'empty' | 'error'
} & ComponentProps<'div'>) {
  return (
    <div
      role={variant === 'error' ? 'alert' : variant === 'loading' ? 'status' : undefined}
      {...props}
      className={cn(
        'flex items-center justify-center gap-2 p-8 text-center text-sm font-medium',
        variant === 'error' ? 'text-destructive' : 'text-muted-foreground',
        className
      )}
    >
      {variant === 'loading' && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
      {children}
    </div>
  )
}
