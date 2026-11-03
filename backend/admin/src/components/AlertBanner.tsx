import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api, ActiveAlert } from '../api/client'
import { Icon } from './Icon'

// Shown above every admin page while a system alert is active (failed or
// stale backup, low disk space — backend/src/services/systemAlerts.ts).
// Re-checked on every navigation; fail-soft, like the update check.
export function AlertBanner() {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const [alerts, setAlerts] = useState<ActiveAlert[]>([])

  useEffect(() => {
    api
      .getSystemAlerts()
      .then((res) => setAlerts(res.alerts))
      .catch(() => {})
  }, [pathname])

  if (alerts.length === 0) return null

  return (
    <div className="card alert-banner" role="alert">
      <span className="alert-banner-icon">
        <Icon name="shield" size={18} />
      </span>
      <ul className="alert-banner-text">
        {alerts.map((alert) => (
          <li key={alert.condition}>{t(`systemStatus.alerts.${alert.condition}`, alert.params)}</li>
        ))}
      </ul>
      {pathname !== '/status' && (
        <Link className="update-banner-link" to="/status">
          {t('systemStatus.alerts.viewStatus')}
        </Link>
      )}
    </div>
  )
}
