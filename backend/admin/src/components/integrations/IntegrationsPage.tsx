import { PageHeader } from '@famlin/ui/common/page-header'
import { StateMessage } from '@famlin/ui/common/state-message'
import { Button } from '@famlin/ui/button'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api, type IntegrationsOverview } from '../../api/client'
import i18n from '../../i18n'
import { Icon } from '../Icon'
import { INTEGRATION_GROUPS, INTEGRATIONS, usageLines } from './registry'
import { StateChip } from './StateChip'

// Every external service Famlin talks to, grouped by what it does for
// families, each with one combined status (set up, last connection check,
// jobs that use it).
export function IntegrationsPage() {
  const { t } = useTranslation()
  const [overview, setOverview] = useState<IntegrationsOverview | null>(null)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api
      .getIntegrations()
      .then(setOverview)
      .catch((err) => setError(err instanceof Error ? err.message : t('common.error')))
  }, [t])

  const checkNow = async () => {
    setChecking(true)
    try {
      setOverview(await api.getIntegrations(true))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'))
    } finally {
      setChecking(false)
    }
  }

  return (
    <>
      <PageHeader
        title={t('integrations.title')}
        actions={
          <div className="integrations-check">
            {overview?.checkedAt && (
              <span className="hint">
                {t('integrations.checkedAt', { date: new Date(overview.checkedAt).toLocaleString(i18n.language) })}
              </span>
            )}
            <Button variant="secondary" onClick={checkNow} disabled={checking}>
              {checking ? t('integrations.checking') : t('integrations.checkNow')}
            </Button>
          </div>
        }
      />
      <p className="settings-intro">{t('integrations.description')}</p>
      {error && <StateMessage variant="error">{error}</StateMessage>}
      {!overview && !error && <StateMessage variant="loading">{t('common.loading')}</StateMessage>}
      {overview &&
        INTEGRATION_GROUPS.map((group) => (
          <section key={group} className="integrations-group">
            <h2>{t(`integrations.groups.${group}`)}</h2>
            <div className="integrations-cards">
              {overview.integrations
                .filter((summary) => INTEGRATIONS[summary.id].group === group)
                .map((summary) => (
                  <Link
                    key={summary.id}
                    to={`/integrations/${summary.id}`}
                    className={`integration-card ${summary.state}`}
                  >
                    <span className="integration-card-top">
                      <span className="integration-card-icon">
                        <Icon name={INTEGRATIONS[summary.id].icon} size={18} />
                      </span>
                      <strong>{t(`integrations.names.${summary.id}`)}</strong>
                      <StateChip state={summary.state} />
                    </span>
                    {usageLines(summary, t).map((line) => (
                      <span key={line} className="integration-card-line">
                        {line}
                      </span>
                    ))}
                    {summary.issues.map((issue) => (
                      <span key={issue} className="integration-card-issue">
                        {t(`integrations.issues.${issue}`)}
                      </span>
                    ))}
                    <span className="integration-card-open">
                      {summary.configured ? t('integrations.open') : t('integrations.setUp')}
                      <Icon name="chevron-right" size={14} />
                    </span>
                  </Link>
                ))}
            </div>
          </section>
        ))}
    </>
  )
}
