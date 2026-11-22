import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createCalendarFeed,
  fetchCalendarFeed,
  revokeCalendarFeed,
  serverSupports,
  CreatedCalendarFeed,
  ServerInfo,
} from '@famlin/api-client'
import { Icon } from '@/components/Icon'
import './CalendarFeedSection.css'

export const CALENDAR_FEED_QUERY_KEY = ['calendar-feed'] as const

// Personal iCal subscription of the member's family events (issue #499).
// The server stores only a hash of the feed's secret, so the URL is visible
// exactly once — right after it's created or regenerated, the same
// show-once pattern as ApiTokensModal. `calendarFeed` postdates the
// server's `features` list, so an older server reports it 'unsupported' and
// the section stays hidden (never a request that would only 404).
export function CalendarFeedSection({ serverInfo }: { serverInfo: ServerInfo | null | undefined }) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const supported = serverSupports(serverInfo, 'calendarFeed')
  // Only set in this page session: the moment the URL can be shown.
  const [created, setCreated] = useState<CreatedCalendarFeed | null>(null)
  const [copied, setCopied] = useState(false)
  const urlInputRef = useRef<HTMLInputElement>(null)

  const statusQuery = useQuery({
    queryKey: CALENDAR_FEED_QUERY_KEY,
    queryFn: fetchCalendarFeed,
    enabled: supported,
  })

  const createMutation = useMutation({
    mutationFn: createCalendarFeed,
    onSuccess: (feed) => {
      setCreated(feed)
      setCopied(false)
      queryClient.invalidateQueries({ queryKey: CALENDAR_FEED_QUERY_KEY })
    },
  })

  const revokeMutation = useMutation({
    mutationFn: revokeCalendarFeed,
    onSuccess: () => {
      setCreated(null)
      setCopied(false)
      queryClient.invalidateQueries({ queryKey: CALENDAR_FEED_QUERY_KEY })
    },
  })

  if (!supported) return null

  const status = statusQuery.data
  const formatDate = (value: string) => new Date(value).toLocaleDateString(i18n.language)

  function regenerate() {
    if (window.confirm(t('calendarFeed.regenerateConfirm'))) createMutation.mutate()
  }

  function turnOff() {
    if (window.confirm(t('calendarFeed.revokeConfirm'))) revokeMutation.mutate()
  }

  async function copyUrl() {
    if (!created) return
    try {
      await navigator.clipboard.writeText(created.url)
      setCopied(true)
    } catch {
      // Clipboard access can be denied (insecure origin, permissions):
      // select the text so the member can copy it by hand.
      urlInputRef.current?.select()
    }
  }

  const error = createMutation.isError
    ? t('calendarFeed.createFailed')
    : revokeMutation.isError
      ? t('calendarFeed.revokeFailed')
      : statusQuery.isError
        ? t('calendarFeed.loadFailed')
        : null

  return (
    <section className="profile-section">
      <h2 className="profile-section-title">{t('calendarFeed.title')}</h2>
      <p className="profile-setting-desc">{t('calendarFeed.description')}</p>

      {error && (
        <div className="profile-error" role="alert">
          {error}
        </div>
      )}

      {statusQuery.isLoading && <p className="profile-setting-desc">{t('common.loading')}</p>}

      {created && (
        <div className="calendar-feed-created" role="status">
          <label className="calendar-feed-url-label" htmlFor="calendar-feed-url">
            {t('calendarFeed.urlLabel')}
          </label>
          <div className="calendar-feed-url-row">
            <input
              id="calendar-feed-url"
              ref={urlInputRef}
              className="field-input calendar-feed-url"
              value={created.url}
              readOnly
              onFocus={(e) => e.currentTarget.select()}
            />
            <button type="button" className="btn btn-secondary" onClick={copyUrl}>
              {copied ? t('calendarFeed.copied') : t('calendarFeed.copy')}
            </button>
          </div>
          <p className="calendar-feed-warning">{t('calendarFeed.shownOnce')}</p>
          <a className="btn btn-primary calendar-feed-open" href={created.webcalUrl}>
            <Icon name="calendar" size={16} />
            {t('calendarFeed.openInApp')}
          </a>
        </div>
      )}

      {status && !status.enabled && !created && (
        <button
          type="button"
          className="btn btn-primary calendar-feed-action"
          onClick={() => createMutation.mutate()}
          disabled={createMutation.isPending}
        >
          <Icon name="calendar" size={16} />
          {createMutation.isPending ? t('common.loading') : t('calendarFeed.create')}
        </button>
      )}

      {status?.enabled && (
        <>
          <div className="calendar-feed-meta">
            {status.createdAt && <span>{t('calendarFeed.createdAt', { date: formatDate(status.createdAt) })}</span>}
            <span>
              {status.lastUsedAt
                ? t('calendarFeed.lastUsed', { date: formatDate(status.lastUsedAt) })
                : t('calendarFeed.neverUsed')}
            </span>
          </div>
          <div className="calendar-feed-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={regenerate}
              disabled={createMutation.isPending || revokeMutation.isPending}
            >
              {t('calendarFeed.regenerate')}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={turnOff}
              disabled={createMutation.isPending || revokeMutation.isPending}
            >
              {t('calendarFeed.revoke')}
            </button>
          </div>
        </>
      )}

      <details className="calendar-feed-help">
        <summary>{t('calendarFeed.howTo')}</summary>
        <ul>
          <li>{t('calendarFeed.howToGoogle')}</li>
          <li>{t('calendarFeed.howToApple')}</li>
          <li>{t('calendarFeed.howToOutlook')}</li>
        </ul>
        <p className="profile-setting-desc">{t('calendarFeed.howToNote')}</p>
      </details>
    </section>
  )
}
