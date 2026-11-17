import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { IntegrationSummary } from '../../api/client'
import { JobsTable } from '../SystemStatusPage'
import { SettingsCard } from '../settings/SettingsCard'

// What an integration has been doing: the runs of the jobs that use it,
// and for push the delivery numbers behind the push log.
export function ActivityTab({ summary }: { summary: IntegrationSummary }) {
  const { t } = useTranslation()
  const rate = (value: number | null) => (value === null ? '—' : `${(value * 100).toFixed(1)}%`)
  const { push } = summary

  return (
    <div className="settings-form">
      {push && (
        <SettingsCard icon="bell" title={t('systemStatus.push.title')}>
          {(['last24h', 'last7d'] as const).map((window) => (
            <div key={window} className="status-row">
              <span>{t(`systemStatus.push.${window}`)}</span>
              <span>
                {t('systemStatus.push.summary', {
                  delivered: push[window].delivered,
                  failed: push[window].failed,
                  rate: rate(push[window].failureRate),
                })}
              </span>
            </div>
          ))}
          {push.unhealthy && <p className="test-err">{t('systemStatus.push.unhealthy')}</p>}
          <Link to="/push-log">{t('systemStatus.push.viewLog')}</Link>
        </SettingsCard>
      )}
      {summary.jobs.length > 0 && (
        <SettingsCard icon="clock" title={t('systemStatus.jobs.title')} desc={t(`integrations.activity.${summary.id}`)}>
          <JobsTable jobs={summary.jobs} />
        </SettingsCard>
      )}
    </div>
  )
}
