import type { ReactNode } from 'react'

export function SaveBar({ children, actions }: { children: ReactNode; actions: ReactNode }) {
  return (
    <div className="sticky bottom-4 z-40 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-3 mt-6 shadow-lg">
      <div className="min-w-0 text-sm font-bold">{children}</div>
      <div className="flex shrink-0 gap-2">{actions}</div>
    </div>
  )
}
