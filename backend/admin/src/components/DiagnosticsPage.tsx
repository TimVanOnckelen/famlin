import { InitialAvatar } from './common/InitialAvatar'
import { PageHeader } from '@famlin/ui/common/page-header'
import { StateMessage } from '@famlin/ui/common/state-message'
import { Card } from '@famlin/ui/card'
import { Button } from '@famlin/ui/button'
import { Badge } from '@famlin/ui/badge'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, type DiagnosticReport } from '../api/client'
import { useAdminDialogs } from './AdminDialogs'

type Rating = 'good' | 'warning' | 'critical'

// Same thresholds as the mobile app's rateHitches() (Apple's hitch time
// ratio): under 5 ms/s is unnoticeable, over 10 a visible problem.
function rateHitches(hitchMsPerSecond: number): Rating {
  if (hitchMsPerSecond < 5) return 'good'
  if (hitchMsPerSecond <= 10) return 'warning'
  return 'critical'
}

const RATING_VARIANT: Record<Rating, 'success' | 'milestone' | 'destructive'> = {
  good: 'success',
  warning: 'milestone',
  critical: 'destructive',
}

function HitchBadge({ label, stats }: { label: string; stats?: { hitchMsPerSecond: number } }) {
  const { t } = useTranslation()
  if (!stats) return null
  const rating = rateHitches(stats.hitchMsPerSecond)
  return (
    <Badge variant={RATING_VARIANT[rating]}>
      {t('diagnostics.hitches', { thread: label, value: stats.hitchMsPerSecond.toFixed(1) })} ·{' '}
      {t(`diagnostics.ratings.${rating}`)}
    </Badge>
  )
}

export function DiagnosticsPage() {
  const { t, i18n } = useTranslation()
  const dialogs = useAdminDialogs()
  const [reports, setReports] = useState<DiagnosticReport[]>([])
  const [retentionDays, setRetentionDays] = useState<number | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const page = await api.getDiagnosticReports()
      setReports(page.items)
      setRetentionDays(page.retentionDays)
      setNextCursor(page.nextCursor)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  async function loadMore() {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      const page = await api.getDiagnosticReports({ cursor: nextCursor })
      setReports((current) => [...current, ...page.items])
      setNextCursor(page.nextCursor)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'))
    } finally {
      setLoadingMore(false)
    }
  }

  async function copyReport(report: DiagnosticReport) {
    try {
      await navigator.clipboard.writeText(report.text)
      setCopiedId(report.id)
      setTimeout(() => setCopiedId((id) => (id === report.id ? null : id)), 2000)
    } catch {
      await dialogs.showMessage(t('diagnostics.copyError'))
    }
  }

  async function removeReport(report: DiagnosticReport) {
    const confirmed = await dialogs.confirmAction(t('diagnostics.removeConfirm', { name: report.user.name }))
    if (!confirmed) return
    try {
      await api.deleteDiagnosticReport(report.id)
      setReports((current) => current.filter((r) => r.id !== report.id))
    } catch (err) {
      await dialogs.showMessage(
        t('diagnostics.removeError', { error: err instanceof Error ? err.message : t('common.error') })
      )
    }
  }

  return (
    <>
      <PageHeader title={t('diagnostics.title')} />
      <p className="md-hint">
        {t('diagnostics.description', { days: retentionDays ?? 30 })}{' '}
        <a href="https://github.com/TimVanOnckelen/famlin/issues" target="_blank" rel="noreferrer">
          {t('diagnostics.issuesLink')}
        </a>
      </p>

      {error && (
        <StateMessage variant="error" className="error" role="alert">
          {error}{' '}
          <Button variant="secondary" className="secondary" onClick={() => void load()}>
            {t('common.retry')}
          </Button>
        </StateMessage>
      )}
      {loading ? (
        <StateMessage variant="loading" className="loading">
          {t('common.loading')}
        </StateMessage>
      ) : reports.length === 0 ? (
        <Card className="p-6 gap-4">
          <StateMessage variant="empty" className="empty">
            {t('diagnostics.empty')}
          </StateMessage>
        </Card>
      ) : (
        <div className="diagnostics-list">
          {reports.map((report) => (
            <Card key={report.id} className="p-6 gap-4 diagnostics-report">
              <div className="diagnostics-report-header">
                <div className="flex items-center gap-3 min-w-0">
                  <InitialAvatar name={report.user.name} avatarUrl={report.user.avatarUrl} />
                  <div className="min-w-0">
                    <strong className="block truncate">{report.user.name}</strong>
                    <span className="cell-sub">
                      {new Date(report.createdAt).toLocaleString(i18n.language)} ·{' '}
                      {t(`diagnostics.kinds.${report.kind}`, { defaultValue: report.kind })} ·{' '}
                      {report.data.device ?? report.platform} · {t('diagnostics.app', { version: report.appVersion })}
                    </span>
                  </div>
                </div>
                <div className="diagnostics-report-actions">
                  <Button variant="secondary" className="secondary" onClick={() => void copyReport(report)}>
                    {copiedId === report.id ? t('diagnostics.copied') : t('diagnostics.copy')}
                  </Button>
                  <Button variant="destructive" className="danger" onClick={() => void removeReport(report)}>
                    {t('diagnostics.remove')}
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <HitchBadge label={t('diagnostics.uiThread')} stats={report.data.ui} />
                <HitchBadge label={t('diagnostics.jsThread')} stats={report.data.js} />
              </div>
              <pre className="diagnostics-report-text">{report.text}</pre>
            </Card>
          ))}
        </div>
      )}
      {!loading && nextCursor && (
        <div className="load-more">
          <Button variant="secondary" className="secondary" disabled={loadingMore} onClick={() => void loadMore()}>
            {loadingMore ? t('common.loading') : t('common.loadMore')}
          </Button>
        </div>
      )}
    </>
  )
}
