import { StateMessage } from '@famlin/ui/common/state-message'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api, type IntegrationSummary, type SystemStatus } from '../../api/client'
import { JobsTable } from '../SystemStatusPage'
import { SettingsCard } from '../settings/SettingsCard'

// What an integration has been doing: the runs of the jobs that use it,
// and for push the delivery numbers behind the push log.
export function ActivityTab({ summary }: { summary: IntegrationSummary }) {
  const { t } = useTranslation()
  const [status, setStatus] = useState<SystemStatus | null>(null)

  useEffect(() => {
    api
      .getSystemStatus()
      .then(setStatus)
      .catch(() => setStatus(null))
  }, [])

  if (!status)
    return (
      <StateMessage variant="loading" className="loading">
        {t('common.loading')}
      </StateMessage>
    )

  const rate = (value: number | null) => (value === null ? '—' : `${Math.round(value * 100)}%`)
  const jobs = status.jobs.filter((job) => summary.jobs.includes(job.job))

  return (
    <div className="settings-form">
      {summary.id === 'push' && (
        <SettingsCard icon="bell" title={t('systemStatus.push.title')}>
          {(['last24h', 'last7d'] as const).map((window) => (
            <div key={window} className="status-row">
              <span>{t(`systemStatus.push.${window}`)}</span>
              <span>
                {t('systemStatus.push.summary', {
                  delivered: status.push[window].delivered,
                  failed: status.push[window].failed,
                  rate: rate(status.push[window].failureRate),
                })}
              </span>
            </div>
          ))}
          {status.push.unhealthy && <p className="test-err">{t('systemStatus.push.unhealthy')}</p>}
          <Link to="/push-log">{t('systemStatus.push.viewLog')}</Link>
        </SettingsCard>
      )}
      {jobs.length > 0 && (
        <SettingsCard icon="clock" title={t('systemStatus.jobs.title')} desc={t(`integrations.activity.${summary.id}`)}>
          <JobsTable jobs={jobs} />
        </SettingsCard>
      )}
    </div>
  )
}
