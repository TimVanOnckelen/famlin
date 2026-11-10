import type { ReactNode } from 'react'
import { cn } from '../lib/utils'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '../card'

interface SectionCardProps {
  title: ReactNode
  icon?: ReactNode
  description?: ReactNode
  badge?: ReactNode
  children: ReactNode
  className?: string
  contentClassName?: string
}

export function SectionCard({
  title,
  icon,
  description,
  badge,
  children,
  className,
  contentClassName,
}: SectionCardProps) {
  return (
    <Card className={cn('shadow-sm', className)}>
      <CardHeader className="flex items-start gap-3">
        {icon && (
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary">
            {icon}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <CardTitle className="text-lg font-extrabold">{title}</CardTitle>
          {description && <CardDescription className="mt-1">{description}</CardDescription>}
        </div>
        {badge && <CardAction className="static">{badge}</CardAction>}
      </CardHeader>
      <CardContent className={cn('flex flex-col gap-4', contentClassName)}>{children}</CardContent>
    </Card>
  )
}
