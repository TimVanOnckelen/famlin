import { useState } from 'react'
import { useQueries, useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  fetchGroups,
  fetchGroupMembers,
  fetchMyCircles,
  fetchCircleMembers,
  type Circle,
  type Group,
  type CircleMember,
  type User,
} from '@famlin/api-client'
import { AppShell } from '@/components/AppShell'
import { Avatar } from '@/components/Avatar'
import { Icon } from '@/components/Icon'
import { ScreenHeader } from '@/components/ScreenHeader'
import './FeedPage.css'
import './MembersPage.css'

function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation()
  return (
    <p role="alert" className="members-error">
      {message}{' '}
      <button className="members-retry" onClick={onRetry}>
        {t('common.retry')}
      </button>
    </p>
  )
}

// The people filters (name search / admins only) apply to every list on the
// page. Circles deliberately have no roles, so "admins only" hides them
// entirely rather than showing people the filter can't judge.
function memberMatches(member: { name: string; isAdmin?: boolean }, nameQuery: string, adminsOnly: boolean): boolean {
  if (adminsOnly && !member.isAdmin) return false
  const q = nameQuery.trim().toLowerCase()
  return !q || member.name.toLowerCase().includes(q)
}

function MemberList({
  members,
}: {
  members: (Pick<CircleMember, 'id' | 'name' | 'avatarUrl'> & { isAdmin?: boolean })[]
}) {
  const { t } = useTranslation()
  if (!members.length) return <p className="members-hint">{t('members.noMembers')}</p>
  return (
    <ul className="members-list">
      {members.map((member) => (
        <li key={member.id} className="members-person">
          <Avatar name={member.name} avatarUrl={member.avatarUrl} size={40} />
          <span className="members-person-name">{member.name}</span>
          {member.isAdmin && <span className="members-admin">{t('profile.adminBadge')}</span>}
        </li>
      ))}
    </ul>
  )
}

function CircleSection({
  circle,
  query,
  nameQuery,
}: {
  circle: Circle
  query: UseQueryResult<CircleMember[], Error>
  nameQuery: string
}) {
  const { t } = useTranslation()
  return (
    <section className="members-circle" aria-labelledby={`members-circle-${circle.id}`}>
      <h4 id={`members-circle-${circle.id}`}>{circle.name}</h4>
      {circle.description && <p className="members-description">{circle.description}</p>}
      {query.isPending && (
        <p role="status" className="members-hint">
          {t('common.loading')}
        </p>
      )}
      {query.isError && <LoadError message={t('members.circleMembersFailed')} onRetry={() => void query.refetch()} />}
      {query.isSuccess && (
        <MemberList members={query.data.filter((member) => memberMatches(member, nameQuery, false))} />
      )}
    </section>
  )
}

function FamilySection({
  group,
  highlighted,
  nameQuery,
  adminsOnly,
}: {
  group: Group
  highlighted: boolean
  nameQuery: string
  adminsOnly: boolean
}) {
  const { t } = useTranslation()
  const members = useQuery({ queryKey: ['group-members', group.id], queryFn: () => fetchGroupMembers(group.id) })
  // Only the member-facing endpoint may supply circles for this page.
  const circles = useQuery({ queryKey: ['circles', group.id], queryFn: () => fetchMyCircles(group.id) })
  const circleMembers = useQueries({
    queries: (circles.data ?? []).map((circle) => ({
      queryKey: ['circle-members', circle.id],
      queryFn: () => fetchCircleMembers(circle.id),
    })),
  })
  const filtering = !!nameQuery.trim() || adminsOnly
  const visibleMembers = (members.data ?? []).filter((member) => memberMatches(member, nameQuery, adminsOnly))
  // While filtering, a loaded family with no matching people disappears
  // entirely. Circle members are always family members, so a circle can
  // never match when the family list doesn't. Loading/failed lists stay
  // visible so their status and retry never vanish.
  if (filtering && members.isSuccess && visibleMembers.length === 0) return null

  const visibleCircles = adminsOnly
    ? []
    : (circles.data ?? [])
        .map((circle, index) => ({ circle, query: circleMembers[index] }))
        .filter(
          ({ query }) =>
            !nameQuery.trim() ||
            !query.isSuccess ||
            (query.data ?? []).some((member) => memberMatches(member, nameQuery, false))
        )
  const hideCircles = adminsOnly || (filtering && circles.isSuccess && visibleCircles.length === 0)
  return (
    <section
      className={`members-family${highlighted ? ' members-family-highlighted' : ''}`}
      aria-labelledby={`members-family-${group.id}`}
    >
      <header className="members-family-header">
        <h2 id={`members-family-${group.id}`}>{group.name}</h2>
        {members.isSuccess && (
          <span className="members-count">{t('members.count', { count: visibleMembers.length })}</span>
        )}
      </header>
      {group.description && <p className="members-description">{group.description}</p>}
      {members.isPending && (
        <p role="status" className="members-hint">
          {t('common.loading')}
        </p>
      )}
      {members.isError && (
        <LoadError message={t('members.familyMembersFailed')} onRetry={() => void members.refetch()} />
      )}
      {members.isSuccess && <MemberList members={visibleMembers} />}
      {!hideCircles && (
        <div className="members-circles">
          <h3>{t('members.yourCircles')}</h3>
          {circles.isPending && (
            <p role="status" className="members-hint">
              {t('common.loading')}
            </p>
          )}
          {circles.isError && <LoadError message={t('members.circlesFailed')} onRetry={() => void circles.refetch()} />}
          {circles.isSuccess &&
            (visibleCircles.length ? (
              visibleCircles.map(({ circle, query }) => (
                <CircleSection key={circle.id} circle={circle} query={query} nameQuery={nameQuery} />
              ))
            ) : (
              <p className="members-hint">{t('members.noCircles')}</p>
            ))}
        </div>
      )}
    </section>
  )
}

export function MembersPage({
  user,
  groupId,
  onOpenFeed,
  onOpenPhotos,
  onOpenChat,
  onOpenFavorites,
  onOpenWiki,
  onOpenNotifications,
  onOpenSearch,
  onOpenProfile,
  onLogout,
}: {
  user: User
  groupId?: string
  onOpenFeed: () => void
  onOpenPhotos?: () => void
  onOpenChat?: () => void
  onOpenFavorites?: () => void
  onOpenWiki?: () => void
  onOpenNotifications?: () => void
  onOpenSearch?: (groupId?: string) => void
  onOpenProfile: () => void
  onLogout: () => void
}) {
  const { t } = useTranslation()
  const groups = useQuery({ queryKey: ['groups'], queryFn: fetchGroups })
  // Like the feed's family filter: empty selection = every family. The
  // `groupId` prop stays a separate highlight, not a filter — arriving from
  // one family's feed still shows all families.
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([])
  const [nameQuery, setNameQuery] = useState('')
  const [adminsOnly, setAdminsOnly] = useState(false)
  const allGroups = groups.data ?? []
  const visibleGroups = selectedGroupIds.length
    ? allGroups.filter((group) => selectedGroupIds.includes(group.id))
    : allGroups
  const filtering = !!nameQuery.trim() || adminsOnly
  // Observers of the same queries the family sections render (React Query
  // dedupes by key), only to know whether anything matches at all — the
  // sections hide themselves, so the page needs its own view for the hint.
  const memberQueries = useQueries({
    queries: visibleGroups.map((group) => ({
      queryKey: ['group-members', group.id],
      queryFn: () => fetchGroupMembers(group.id),
    })),
  })
  const nothingMatches =
    filtering &&
    memberQueries.length > 0 &&
    memberQueries.every(
      (query) => query.isSuccess && !(query.data ?? []).some((member) => memberMatches(member, nameQuery, adminsOnly))
    )
  function toggleGroup(groupId: string) {
    setSelectedGroupIds((prev) => (prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId]))
  }
  return (
    <AppShell
      user={user}
      active="members"
      onFeed={onOpenFeed}
      onPhotos={onOpenPhotos}
      onChat={onOpenChat}
      onFavorites={onOpenFavorites}
      onWiki={onOpenWiki}
      onNotifications={onOpenNotifications}
      onSearch={onOpenSearch}
      onProfile={onOpenProfile}
      onLogout={onLogout}
    >
      <div className="members-column">
        <ScreenHeader title={t('members.title')} onBack={onOpenFeed} />
        <p className="members-intro">{t('members.description')}</p>
        {groups.isPending && <p role="status">{t('common.loading')}</p>}
        {groups.isError && <LoadError message={t('members.familiesFailed')} onRetry={() => void groups.refetch()} />}
        {groups.isSuccess && allGroups.length > 0 && (
          <>
            {allGroups.length > 1 && (
              <div className="feed-filter members-family-filter" role="group" aria-label={t('feed.filterLabel')}>
                <button
                  type="button"
                  className={`filter-chip${selectedGroupIds.length === 0 ? ' filter-chip-active' : ''}`}
                  aria-pressed={selectedGroupIds.length === 0}
                  onClick={() => setSelectedGroupIds([])}
                >
                  {t('feed.allFamilies')}
                </button>
                {allGroups.map((group) => (
                  <button
                    key={group.id}
                    type="button"
                    className={`filter-chip${selectedGroupIds.includes(group.id) ? ' filter-chip-active' : ''}`}
                    aria-pressed={selectedGroupIds.includes(group.id)}
                    onClick={() => toggleGroup(group.id)}
                  >
                    {group.name}
                  </button>
                ))}
              </div>
            )}
            <div className="members-controls">
              <label className="members-search">
                <Icon name="search" size={20} />
                <input
                  type="search"
                  maxLength={200}
                  value={nameQuery}
                  onChange={(event) => setNameQuery(event.target.value)}
                  aria-label={t('members.searchPlaceholder')}
                  placeholder={t('members.searchPlaceholder')}
                />
              </label>
              <button
                type="button"
                className={`filter-chip${adminsOnly ? ' filter-chip-active' : ''}`}
                aria-pressed={adminsOnly}
                onClick={() => setAdminsOnly((prev) => !prev)}
              >
                {t('members.adminsOnly')}
              </button>
            </div>
          </>
        )}
        {groups.isSuccess &&
          (allGroups.length ? (
            visibleGroups.map((group) => (
              <FamilySection
                key={group.id}
                group={group}
                highlighted={group.id === groupId}
                nameQuery={nameQuery}
                adminsOnly={adminsOnly}
              />
            ))
          ) : (
            <p className="members-empty">{t('members.noFamilies')}</p>
          ))}
        {nothingMatches && <p className="members-empty">{t('members.noResults')}</p>}
      </div>
    </AppShell>
  )
}
