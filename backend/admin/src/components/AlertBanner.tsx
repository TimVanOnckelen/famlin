import { Alert } from '@famlin/ui/alert'
import { Button } from '@famlin/ui/button'
import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api, ActiveAlert } from '../api/client'
import type { UpdateNotice } from '../types'
import { Icon } from './Icon'

const MAINTENANCE_DOCS_URL = 'https://famlin.app/docs/maintenance'
const DISMISSED_KEY = 'famlin-admin-dismissed-update'

function readDismissed(): string | null {
  try {
    return localStorage.getItem(DISMISSED_KEY)
  } catch {
    return null
  }
}

// Shown above every admin page while a system alert is active (failed or
// stale backup, low disk space — backend/src/services/systemAlerts.ts) or a
// newer Famlin release exists (backend/src/services/updateCheck.ts). Re-checked
// on every navigation; fail-soft: any error renders nothing.
export function AlertBanner() {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const [alerts, setAlerts] = useState<ActiveAlert[]>([])
  const [update, setUpdate] = useState<UpdateNotice | null>(null)
  const [dismissed, setDismissed] = useState<string | null>(readDismissed)

  useEffect(() => {
    api
      .getSystemAlerts()
      .then((res) => {
        setAlerts(res.alerts)
        setUpdate(res.update ?? null)
      })
      .catch(() => {})
  }, [pathname])

  const dismissUpdate = () => {
    if (!update) return
    setDismissed(update.latest)
    try {
      localStorage.setItem(DISMISSED_KEY, update.latest)
    } catch {
      // Storage unavailable: dismissed for this session only.
    }
  }

  const showUpdate = !!update && update.updateAvailable && dismissed !== update.latest

  return (
    <>
      {alerts.length > 0 && (
        <Alert className="mb-6 flex flex-wrap items-center gap-4 border-destructive/20 bg-destructive/10 p-5">
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
        </Alert>
      )}
      {showUpdate && update && (
        <Alert
          className={`mb-6 flex flex-wrap items-center gap-4 p-5 ${update.breaking ? 'border-warning/20 bg-warning/10' : 'border-primary/10 bg-secondary'}`}
          role="status"
        >
          <span className="update-banner-icon">
            <Icon name="bell" size={18} />
          </span>
          <div className="update-banner-text">
            <strong>{t('updateBanner.title', { latest: update.latest })}</strong>
            <span className="hint" style={{ marginTop: 0 }}>
              {update.breaking
                ? t('updateBanner.breaking', { latest: update.latest })
                : t('updateBanner.current', { current: update.current })}
            </span>
            {update.breaking && (
              <span className="hint" style={{ marginTop: 0 }}>
                {t('updateBanner.current', { current: update.current })}
              </span>
            )}
          </div>
          <a className="update-banner-link" href={update.url} target="_blank" rel="noreferrer">
            {t('updateBanner.releaseNotes')}
          </a>
          <a className="update-banner-link" href={MAINTENANCE_DOCS_URL} target="_blank" rel="noreferrer">
            {t('updateBanner.howToUpdate')}
          </a>
          <Button
            variant="secondary"
            type="button"
            className="secondary"
            onClick={dismissUpdate}
            aria-label={t('updateBanner.dismiss')}
          >
            {t('updateBanner.dismiss')}
          </Button>
        </Alert>
      )}
    </>
  )
}
