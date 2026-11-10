import { InitialAvatar } from '@/components/common/InitialAvatar'
import { Badge } from '@famlin/ui/badge'
import { Button } from '@famlin/ui/button'
import { useTranslation } from 'react-i18next'
import type { GroupMember } from '../api/client'
import { Icon } from './Icon'

export function MemberCards({
  members,
  onRemove,
  disabled = false,
}: {
  members: GroupMember[]
  onRemove: (member: GroupMember) => void
  disabled?: boolean
}) {
  const { t, i18n } = useTranslation()
  return (
    <ul className="member-cards">
      {members.map((member) => (
        <li key={member.id} className="member-card">
          <InitialAvatar name={member.name} avatarUrl={member.avatarUrl} />
          <span className="member-card-info">
            <span className="member-card-name">
              {member.name}
              {member.isAdmin && <Badge variant="default">{t('common.admin')}</Badge>}
              {!member.hasPassword && <Badge variant="accent">{t('users.table.sso')}</Badge>}
            </span>
            <span className="member-card-sub">
              {member.email} ·{' '}
              {t('groups.joinedOn', { date: new Date(member.joinedAt).toLocaleDateString(i18n.language) })}
            </span>
          </span>
          <Button
            variant="destructive"
            size="icon"
            type="button"
            className="icon-button danger"
            aria-label={t('members.removeNamed', { name: member.name })}
            title={t('common.remove')}
            disabled={disabled}
            onClick={() => onRemove(member)}
          >
            <Icon name="x" size={14} />
          </Button>
        </li>
      ))}
    </ul>
  )
}
