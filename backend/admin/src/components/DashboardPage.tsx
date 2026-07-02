import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, DashboardStats } from '../api/client';
import { Icon, IconName } from './Icon';
import i18n from '../i18n';

export function DashboardPage() {
  const { t } = useTranslation();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [hoveredDay, setHoveredDay] = useState<number | null>(null);

  useEffect(() => {
    api
      .getStats()
      .then(setStats)
      .finally(() => setLoading(false));
  }, []);

  if (loading || !stats) return <div className="loading">{t('common.loading')}</div>;

  const maxDayCount = Math.max(1, ...stats.postsByDay.map((d) => d.count));
  const maxGroupPosts = Math.max(1, ...stats.topGroups.map((g) => g.postCount));

  return (
    <>
      <div className="page-header">
        <h2>{t('dashboard.title')}</h2>
      </div>

      <div className="stat-grid">
        <StatTile
          icon="users"
          label={t('dashboard.stats.users')}
          value={stats.counts.users}
          sub={t('dashboard.stats.usersSub', { count: stats.counts.admins })}
        />
        <StatTile icon="layers" label={t('dashboard.stats.groups')} value={stats.counts.groups} />
        <StatTile icon="image" label={t('dashboard.stats.posts')} value={stats.counts.posts} />
        <StatTile
          icon="message-circle"
          label={t('dashboard.stats.comments')}
          value={stats.counts.comments}
        />
        <StatTile icon="heart" label={t('dashboard.stats.likes')} value={stats.counts.likes} />
      </div>

      <div className="card">
        <h3>{t('dashboard.trend.title')}</h3>
        <div className="bar-chart">
          {stats.postsByDay.map((day, i) => {
            const pct = (day.count / maxDayCount) * 100;
            const localDate = new Date(`${day.date}T00:00:00`);
            return (
              <div
                key={day.date}
                className="bar-col"
                onMouseEnter={() => setHoveredDay(i)}
                onMouseLeave={() => setHoveredDay(null)}
              >
                {hoveredDay === i && (
                  <div className="bar-tooltip">
                    {t('dashboard.trend.tooltip', {
                      count: day.count,
                      date: localDate.toLocaleDateString(i18n.language, {
                        month: 'short',
                        day: 'numeric',
                      }),
                    })}
                  </div>
                )}
                <div className="bar-fill" style={{ height: `${day.count === 0 ? 0 : Math.max(pct, 6)}%` }} />
              </div>
            );
          })}
        </div>
        <div className="bar-chart-labels">
          {stats.postsByDay.map((day) => {
            const localDate = new Date(`${day.date}T00:00:00`);
            return (
              <span key={day.date} className="bar-chart-label">
                {localDate.toLocaleDateString(i18n.language, { weekday: 'narrow' })}
              </span>
            );
          })}
        </div>
      </div>

      <div className="dashboard-columns">
        <div className="dashboard-col-main">
          <div className="card">
            <h3>{t('dashboard.activity.title')}</h3>
            {stats.recentPosts.length === 0 ? (
              <div className="empty">{t('dashboard.activity.empty')}</div>
            ) : (
              <ul className="member-cards">
                {stats.recentPosts.map((post) => (
                  <li key={post.id} className="member-card">
                    <span className="avatar" style={{ background: avatarColor(post.authorName) }}>
                      {initials(post.authorName)}
                    </span>
                    <div className="member-card-info">
                      <div className="member-card-name">
                        {post.authorName}
                        <span className={`badge${post.type === 'MILESTONE' ? ' milestone' : ''}`}>
                          {post.type === 'MILESTONE'
                            ? t('dashboard.activity.milestone')
                            : t('dashboard.activity.update')}
                        </span>
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
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="dashboard-col-side">
          <div className="card">
            <h3>{t('dashboard.topGroups.title')}</h3>
            {stats.topGroups.length === 0 ? (
              <div className="empty">{t('dashboard.topGroups.empty')}</div>
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
          </div>

          <div className="card">
            <h3>{t('dashboard.quickLinks')}</h3>
            <ul>
              <li>
                <a href="https://famlin.app/docs" target="_blank" rel="noreferrer">
                  {t('dashboard.apiDocs')}
                </a>
              </li>

            </ul>
          </div>
        </div>
      </div>
    </>
  );
}

interface StatTileProps {
  icon: IconName;
  label: string;
  value: number;
  sub?: string;
}

function StatTile({ icon, label, value, sub }: StatTileProps) {
  return (
    <div className="stat-tile">
      <span className="stat-tile-icon">
        <Icon name={icon} size={18} />
      </span>
      <span className="stat-tile-value">{value.toLocaleString(i18n.language)}</span>
      <span className="stat-tile-label">{label}</span>
      {sub && <span className="stat-tile-sub">{sub}</span>}
    </div>
  );
}

function initials(name: string) {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function avatarColor(name: string) {
  const palette = ['#006e94', '#318ea2', '#187191', '#005480', '#ed835e'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return palette[Math.abs(hash) % palette.length];
}
