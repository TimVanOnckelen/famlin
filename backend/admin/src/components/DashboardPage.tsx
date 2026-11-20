import { StateMessage } from '@famlin/ui/common/state-message'
import { PageHeader } from '@famlin/ui/common/page-header'
import { SectionCard } from '@famlin/ui/common/section-card'
import { InitialAvatar } from '@/components/common/InitialAvatar'
import { Badge } from '@famlin/ui/badge'
import { Card } from '@famlin/ui/card'
import { Button } from '@famlin/ui/button'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, DashboardStats } from '../api/client'
import { Icon, IconName } from './Icon'
import i18n from '../i18n'
import { Link } from 'react-router-dom'
import { ConnectAppQr } from './ConnectAppQr'
import {
  SetupChecklist,
  dismissChecklist,
  isChecklistComplete,
  isChecklistDismissed,
  loadSetupChecklist,
} from '../setupChecklist'

// Every registered post type gets its own label; an unknown future type
// falls back to its raw id rather than mislabeling it as an update.
const POST_TYPE_BADGES: Record<string, { key: string; variant: 'milestone' | 'accent' | 'secondary' }> = {
  UPDATE: { key: 'update', variant: 'secondary' },
  MILESTONE: { key: 'milestone', variant: 'milestone' },
  POLL: { key: 'poll', variant: 'accent' },
  TRIP: { key: 'trip', variant: 'accent' },
  ALBUM: { key: 'album', variant: 'secondary' },
  GIFT_LIST: { key: 'giftList', variant: 'secondary' },
  EVENT: { key: 'event', variant: 'secondary' },
}

export function DashboardPage() {
  const { t } = useTranslation()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [storeLinks, setStoreLinks] = useState<{ appStoreUrl?: string | null; playStoreUrl?: string | null }>({})

  const [checklist, setChecklist] = useState<SetupChecklist | null>(null)
  const [checklistDismissed, setChecklistDismissed] = useState(isChecklistDismissed)

  useEffect(() => {
    if (checklistDismissed) return
    loadSetupChecklist()
      .then(setChecklist)
      .catch(() => {})
  }, [checklistDismissed])

  const loadStats = useCallback(() => {
    setLoading(true)
    setLoadError(false)
    api
      .getStats()
      .then(setStats)
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false))
  }, [])

  useEffect(loadStats, [loadStats])

  // Store links for the "Connect the mobile app" card; the card works without them.
  useEffect(() => {
    api
      .getServerInfo()
      .then((info) => setStoreLinks({ appStoreUrl: info.appStoreUrl, playStoreUrl: info.playStoreUrl }))
      .catch(() => {})
  }, [])

  if (loadError)
    return (
      <>
        <PageHeader title={t('dashboard.title')} />
        <StateMessage variant="error">
          {t('dashboard.loadError')}
          <Button variant="secondary" size="sm" type="button" onClick={loadStats}>
            {t('common.retry')}
          </Button>
        </StateMessage>
      </>
    )

  if (loading || !stats)
    return (
      <StateMessage variant="loading" className="loading">
        {t('common.loading')}
      </StateMessage>
    )

  const maxDayCount = Math.max(1, ...stats.postsByDay.map((d) => d.count))
  const maxGroupPosts = Math.max(1, ...stats.topGroups.map((g) => g.postCount))

  return (
    <>
      <PageHeader
        title={t('dashboard.title')}
        actions={
          <Button variant="secondary" size="sm" type="button" onClick={loadStats} disabled={loading}>
            <Icon name="rotate-ccw" size={14} />
            {t('dashboard.refresh')}
          </Button>
        }
      />

      {checklist && !checklistDismissed && !isChecklistComplete(checklist) && (
        <SectionCard title={t('checklist.title')} icon={<Icon name="check" size={20} />}>
          <ul className="checklist">
            {(
              [
                ['groupExists', checklist.groupExists],
                ['adminInGroup', checklist.adminInGroup],
                ['invited', checklist.invited],
                ['backupsOn', checklist.backupsOn],
              ] as const
            ).map(([key, done]) => (
              <li key={key} className={done ? 'done' : ''}>
                <span className={`checklist-mark${done ? ' done' : ''}`} aria-hidden="true">
                  {done && <Icon name="check" size={11} />}
                </span>
                {t(`checklist.${key}`)}
              </li>
            ))}
          </ul>
          <div className="wizard-actions">
            <Button nativeButton={false} render={<Link to="/getting-started" />}>
              {t('checklist.continue')}
            </Button>
            <Button
              variant="secondary"
              type="button"
              onClick={() => {
                dismissChecklist()
                setChecklistDismissed(true)
              }}
            >
              {t('checklist.dismiss')}
            </Button>
          </div>
        </SectionCard>
      )}

      <div className="stat-grid">
        <StatTile
          icon="users"
          label={t('dashboard.stats.users')}
          value={stats.counts.users}
          sub={t('dashboard.stats.usersSub', { count: stats.counts.admins })}
        />
        <StatTile icon="layers" label={t('dashboard.stats.groups')} value={stats.counts.groups} />
        <StatTile icon="image" label={t('dashboard.stats.posts')} value={stats.counts.posts} />
        <StatTile icon="message-circle" label={t('dashboard.stats.comments')} value={stats.counts.comments} />
        <StatTile icon="heart" label={t('dashboard.stats.likes')} value={stats.counts.likes} />
      </div>

      <SectionCard title={t('dashboard.trend.title')} icon={<Icon name="status" size={20} />}>
        {/* Tooltips are CSS-only (hover/focus) so pointing at a bar never
            re-renders the page; each bar is focusable and labeled for
            keyboard and screen-reader users. */}
        <div className="bar-chart" role="group" aria-label={t('dashboard.trend.title')}>
          {stats.postsByDay.map((day) => {
            const pct = (day.count / maxDayCount) * 100
            const localDate = new Date(`${day.date}T00:00:00`)
            const label = t('dashboard.trend.tooltip', {
              count: day.count,
              date: localDate.toLocaleDateString(i18n.language, {
                month: 'short',
                day: 'numeric',
              }),
            })
            return (
              <div key={day.date} className="bar-col" tabIndex={0} role="img" aria-label={label}>
                <div className="bar-tooltip">{label}</div>
                <div className="bar-fill" style={{ height: `${day.count === 0 ? 0 : Math.max(pct, 6)}%` }} />
              </div>
            )
          })}
        </div>
        <div className="bar-chart-labels" aria-hidden="true">
          {stats.postsByDay.map((day) => {
            const localDate = new Date(`${day.date}T00:00:00`)
            return (
              <span key={day.date} className="bar-chart-label">
                {localDate.toLocaleDateString(i18n.language, { weekday: 'narrow' })}
              </span>
            )
          })}
        </div>
      </SectionCard>

      <div className="dashboard-columns">
        <div className="dashboard-col-main">
          <SectionCard title={t('dashboard.activity.title')} icon={<Icon name="content" size={20} />}>
            {stats.recentPosts.length === 0 ? (
              <StateMessage variant="empty" className="empty">
                {t('dashboard.activity.empty')}
              </StateMessage>
            ) : (
              <ul className="member-cards">
                {stats.recentPosts.map((post) => {
                  const typeBadge = POST_TYPE_BADGES[post.type]
                  return (
                    <li key={post.id} className="member-card">
                      <InitialAvatar name={post.authorName} avatarUrl={post.authorAvatarUrl} />
                      <div className="member-card-info">
                        <div className="member-card-name">
                          {post.authorName}
                          <Badge variant={typeBadge?.variant ?? 'secondary'}>
                            {typeBadge ? t(`dashboard.activity.${typeBadge.key}`) : post.type}
                          </Badge>
                        </div>
                        <div className="member-card-sub">
                          {t('dashboard.activity.postedIn', { group: post.groupName })} ·{' '}
                          {new Date(post.createdAt).toLocaleString(i18n.language, {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          })}
                        </div>
                      </div>
                      <div className="activity-counts">
                        <span title={t('dashboard.stats.comments')}>
                          <Icon name="message-circle" size={14} /> {post.commentCount}
                        </span>
                        <span title={t('dashboard.stats.likes')}>
                          <Icon name="heart" size={14} /> {post.likeCount}
                        </span>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </SectionCard>
        </div>

        <div className="dashboard-col-side">
          <SectionCard title={t('dashboard.topGroups.title')} icon={<Icon name="layers" size={20} />}>
            {stats.topGroups.length === 0 ? (
              <StateMessage variant="empty" className="empty">
                {t('dashboard.topGroups.empty')}
              </StateMessage>
            ) : (
              <ul className="topgroup-list">
                {stats.topGroups.map((group) => (
                  <li key={group.id} className="topgroup-row">
                    <span className="topgroup-name">{group.name}</span>
                    <div className="topgroup-bar-track">
                      <div
                        className="topgroup-bar-fill"
                        style={{ width: `${(group.postCount / maxGroupPosts) * 100}%` }}
                      />
                    </div>
                    <span className="topgroup-count">{group.postCount}</span>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard title={t('connectApp.title')} icon={<Icon name="devices" size={20} />}>
            <ConnectAppQr appStoreUrl={storeLinks.appStoreUrl} playStoreUrl={storeLinks.playStoreUrl} />
          </SectionCard>

          <SectionCard title={t('dashboard.quickLinks')} icon={<Icon name="globe" size={20} />}>
            <ul className="m-0 list-none p-0">
              <li>
                <a
                  className="flex w-fit items-center gap-1.5 text-sm font-bold text-primary hover:underline"
                  href="https://famlin.app/docs"
                  target="_blank"
                  rel="noreferrer"
                >
                  {t('dashboard.apiDocs')}
                  <Icon name="chevron-right" size={14} />
                </a>
              </li>
            </ul>
          </SectionCard>
        </div>
      </div>
    </>
  )
}

interface StatTileProps {
  icon: IconName
  label: string
  value: number
  sub?: string
}

function StatTile({ icon, label, value, sub }: StatTileProps) {
  return (
    <Card className="flex-row items-center gap-3 px-4 py-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-[var(--fam-primary-tint)] text-primary">
        <Icon name={icon} size={18} />
      </span>
      <div className="flex min-w-0 flex-col gap-0.5 [overflow-wrap:anywhere]">
        <span className="text-2xl leading-none font-black">{value.toLocaleString(i18n.language)}</span>
        <span className="text-xs font-bold text-muted-foreground">{label}</span>
        {sub && <span className="text-[0.7rem] font-semibold text-muted-foreground">{sub}</span>}
      </div>
    </Card>
  )
}
