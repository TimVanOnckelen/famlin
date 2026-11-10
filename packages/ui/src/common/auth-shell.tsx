import type { ReactNode } from 'react'
import { Card } from '../card'

export function AuthShell({ children, logo }: { children: ReactNode; logo: ReactNode }) {
  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-md gap-4 p-8 text-center shadow-lg sm:p-10">
        <div className="flex justify-center">{logo}</div>
        {children}
      </Card>
    </div>
  )
}
