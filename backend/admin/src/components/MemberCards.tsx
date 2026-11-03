import { useTranslation } from 'react-i18next'
import type { GroupMember } from '../api/client'
import { avatarColor, initials } from '../avatar'
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
          <span className="avatar" style={{ background: avatarColor(member.name) }}>
            {initials(member.name)}
          </span>
          <span className="member-card-info">
            <span className="member-card-name">
              {member.name}
              {member.isAdmin && <span className="badge admin">{t('common.admin')}</span>}
              {!member.hasPassword && <span className="badge sso">{t('users.table.sso')}</span>}
            </span>
            <span className="member-card-sub">
              {member.email} ·{' '}
              {t('groups.joinedOn', { date: new Date(member.joinedAt).toLocaleDateString(i18n.language) })}
            </span>
          </span>
          <button
            type="button"
            className="icon-button danger"
            aria-label={t('members.removeNamed', { name: member.name })}
            title={t('common.remove')}
            disabled={disabled}
            onClick={() => onRemove(member)}
          >
            <Icon name="x" size={14} />
          </button>
        </li>
      ))}
    </ul>
  )
}
