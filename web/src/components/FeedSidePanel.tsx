import { useTranslation } from 'react-i18next'
import { useQueries, useQuery } from '@tanstack/react-query'
import { fetchGroupMembers, fetchOnThisDay, type Group, type GroupMember } from '@famlin/api-client'
import { Avatar } from '@/components/Avatar'
import { Icon } from '@/components/Icon'
import './FeedSidePanel.css'

export function FeedSidePanel({
  groups,
  selectedGroupIds,
  onOpenPost,
  onToggleGroup,
  onSelectAllGroups,
}: {
  groups: Group[]
  selectedGroupIds: string[]
  onToggleGroup: (groupId: string) => void
  onSelectAllGroups: () => void
  onOpenPost: (postId: string) => void
}) {
  const { t } = useTranslation()
  const memberGroups = selectedGroupIds.length ? groups.filter((g) => selectedGroupIds.includes(g.id)) : groups
  const memoryGroupId = memberGroups.length === 1 ? memberGroups[0].id : undefined

  const onThisDayQuery = useQuery({
    queryKey: ['onThisDay', memoryGroupId],
    queryFn: () => fetchOnThisDay(memoryGroupId!),
    enabled: !!memoryGroupId,
  })
  const memberQueries = useQueries({
    queries: memberGroups.map((group) => ({
      queryKey: ['group-members', group.id],
      queryFn: () => fetchGroupMembers(group.id),
      staleTime: 60_000,
    })),
  })
  const membersById = new Map<string, GroupMember & { groups: string[] }>()
  memberQueries.forEach((query, index) => {
    for (const member of query.data ?? []) {
      const existing = membersById.get(member.id)
      if (existing) existing.groups.push(memberGroups[index].name)
      else membersById.set(member.id, { ...member, groups: [memberGroups[index].name] })
    }
  })
  const members = [...membersById.values()].sort((a, b) => a.name.localeCompare(b.name))
  const loading = memberQueries.some((query) => query.isPending)
  const failed = memberQueries.some((query) => query.isError)
  const onThisDay = memoryGroupId ? (onThisDayQuery.data ?? []) : []

  return (
    <aside
      className={`feed-side-panel${groups.length === 1 ? ' feed-side-panel-single' : ''}`}
      aria-label={t('feed.sidePanelLabel')}
    >
      {groups.length > 1 && (
        <section className="side-panel-section side-panel-groups" aria-label={t('feed.filterLabel')}>
          <h2 className="side-panel-title">{t('feed.filterLabel')}</h2>
          {groups.length > 1 && (
            <button
              type="button"
              className="side-panel-group-row"
              aria-pressed={selectedGroupIds.length === 0}
              onClick={onSelectAllGroups}
            >
              <span className="side-panel-group-title">{t('feed.allFamilies')}</span>
              {selectedGroupIds.length === 0 && <Icon name="check" size={16} />}
            </button>
          )}
          {groups.map((group) => (
            <button
              key={group.id}
              type="button"
              className="side-panel-group-row"
              aria-label={group.name}
              aria-describedby={group.description ? `side-panel-group-${group.id}` : undefined}
              aria-pressed={selectedGroupIds.includes(group.id) || groups.length === 1}
              onClick={() => onToggleGroup(group.id)}
            >
              <span className="side-panel-group-info">
                <span className="side-panel-group-title">{group.name}</span>
                {group.description && (
                  <span id={`side-panel-group-${group.id}`} className="side-panel-group-description">
                    {group.description}
                  </span>
                )}
              </span>
              {(selectedGroupIds.includes(group.id) || groups.length === 1) && <Icon name="check" size={16} />}
            </button>
          ))}
        </section>
      )}
      <section className="side-panel-section side-panel-members-card" aria-labelledby="side-panel-members-title">
        <h2 id="side-panel-members-title" className="side-panel-title">
          {t('feed.membersTitle')}
        </h2>
        <div className="side-panel-members-body" aria-busy={loading}>
          {loading && (
            <p className="side-panel-message" role="status">
              {t('common.loading')}
            </p>
          )}
          {failed && (
            <div className="side-panel-message" role="alert">
              <p>{t('feed.membersLoadFailed')}</p>
              <button
                type="button"
                className="side-panel-retry"
                onClick={() =>
                  memberQueries.forEach((query) => {
                    if (query.isError) void query.refetch()
                  })
                }
              >
                {t('feed.membersRetry')}
              </button>
            </div>
          )}
          {!loading && !failed && members.length === 0 && (
            <p className="side-panel-message">{t('feed.membersEmpty')}</p>
          )}
          <ul className="side-panel-members">
            {members.map((member) => (
              <li key={member.id} className="side-panel-member">
                <Avatar name={member.name} avatarUrl={member.avatarUrl} size={32} />
                <div className="side-panel-member-info">
                  <span className="side-panel-member-name">{member.name}</span>
                  {memberGroups.length > 1 && (
                    <span className="side-panel-member-groups">{member.groups.join(' · ')}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>
      {onThisDay.length > 0 && (
        <section className="side-panel-section">
          <h2 className="side-panel-title">{t('feed.onThisDayTitle')}</h2>
          <button type="button" className="side-panel-on-this-day" onClick={() => onOpenPost(onThisDay[0].id)}>
            <span className="side-panel-on-this-day-icon" aria-hidden>
              <Icon name="clock" size={18} />
            </span>
            <span className="side-panel-on-this-day-count">
              {t('feed.onThisDayCount', { count: onThisDay.length })}
            </span>
          </button>
        </section>
      )}
    </aside>
  )
}
