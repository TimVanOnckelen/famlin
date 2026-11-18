import { useEffect, useState } from 'react'
import { api, ActiveAlert } from '../api/client'
import type { UpdateNotice } from '../types'

// The one fetch behind both the AlertBanner and the sidebar's alert dots.
// Re-checked on every navigation; fail-soft: any error renders nothing.
export function useSystemAlerts(pathname: string) {
  const [alerts, setAlerts] = useState<ActiveAlert[]>([])
  const [update, setUpdate] = useState<UpdateNotice | null>(null)

  useEffect(() => {
    api
      .getSystemAlerts()
      .then((res) => {
        setAlerts(res.alerts)
        setUpdate(res.update ?? null)
      })
      .catch(() => {})
  }, [pathname])

  return { alerts, update }
}
