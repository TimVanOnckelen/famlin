import { useQuery } from '@tanstack/react-query'
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
import { ScreenHeader } from '@/components/ScreenHeader'
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

function CircleSection({ circle }: { circle: Circle }) {
  const { t } = useTranslation()
  const members = useQuery({ queryKey: ['circle-members', circle.id], queryFn: () => fetchCircleMembers(circle.id) })
  return (
    <section className="members-circle" aria-labelledby={`members-circle-${circle.id}`}>
      <h4 id={`members-circle-${circle.id}`}>{circle.name}</h4>
      {circle.description && <p className="members-description">{circle.description}</p>}
      {members.isPending && (
        <p role="status" className="members-hint">
          {t('common.loading')}
        </p>
      )}
      {members.isError && (
        <LoadError message={t('members.circleMembersFailed')} onRetry={() => void members.refetch()} />
      )}
      {members.isSuccess && <MemberList members={members.data} />}
    </section>
  )
}

function FamilySection({ group, highlighted }: { group: Group; highlighted: boolean }) {
  const { t } = useTranslation()
  const members = useQuery({ queryKey: ['group-members', group.id], queryFn: () => fetchGroupMembers(group.id) })
  // Only the member-facing endpoint may supply circles for this page.
  const circles = useQuery({ queryKey: ['circles', group.id], queryFn: () => fetchMyCircles(group.id) })
  return (
    <section
      className={`members-family${highlighted ? ' members-family-highlighted' : ''}`}
      aria-labelledby={`members-family-${group.id}`}
    >
      <header className="members-family-header">
        <h2 id={`members-family-${group.id}`}>{group.name}</h2>
        {members.isSuccess && (
          <span className="members-count">{t('members.count', { count: members.data.length })}</span>
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
      {members.isSuccess && <MemberList members={members.data} />}
      <div className="members-circles">
        <h3>{t('members.yourCircles')}</h3>
        {circles.isPending && (
          <p role="status" className="members-hint">
            {t('common.loading')}
          </p>
        )}
        {circles.isError && <LoadError message={t('members.circlesFailed')} onRetry={() => void circles.refetch()} />}
        {circles.isSuccess &&
          (circles.data.length ? (
            circles.data.map((circle) => <CircleSection key={circle.id} circle={circle} />)
          ) : (
            <p className="members-hint">{t('members.noCircles')}</p>
          ))}
      </div>
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
  onOpenNotifications?: () => void
  onOpenSearch?: (groupId?: string) => void
  onOpenProfile: () => void
  onLogout: () => void
}) {
  const { t } = useTranslation()
  const groups = useQuery({ queryKey: ['groups'], queryFn: fetchGroups })
  return (
    <AppShell
      user={user}
      active="members"
      onFeed={onOpenFeed}
      onPhotos={onOpenPhotos}
      onChat={onOpenChat}
      onFavorites={onOpenFavorites}
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
        {groups.isSuccess &&
          (groups.data.length ? (
            groups.data.map((group) => (
              <FamilySection key={group.id} group={group} highlighted={group.id === groupId} />
            ))
          ) : (
            <p className="members-empty">{t('members.noFamilies')}</p>
          ))}
      </div>
    </AppShell>
  )
}
