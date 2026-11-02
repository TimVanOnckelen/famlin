import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { fetchGroupMembers } from '@famlin/api-client'
import { Avatar } from '@/components/Avatar'

// Chips for choosing a gift list's participants from one family — shared by
// the composer (NewPostModal) and the starter's "Participants" editor on
// GiftListPage. `selected` never contains the current user: the starter is
// always a participant and isn't offered as a chip.
export function GiftListParticipantPicker({
  groupId,
  selfId,
  selected,
  onChange,
}: {
  groupId: string
  selfId: string
  selected: string[]
  onChange: (userIds: string[]) => void
}) {
  const { t } = useTranslation()
  const membersQuery = useQuery({
    queryKey: ['group-members', groupId],
    queryFn: () => fetchGroupMembers(groupId),
    enabled: !!groupId,
  })
  const members = (membersQuery.data ?? []).filter((m) => m.id !== selfId)

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id])
  }

  return (
    <div className="group-select-chips" role="group" aria-label={t('giftList.participants')}>
      {members.map((member) => (
        <button
          key={member.id}
          type="button"
          className={`filter-chip${selected.includes(member.id) ? ' filter-chip-active' : ''}`}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          aria-pressed={selected.includes(member.id)}
          onClick={() => toggle(member.id)}
        >
          <Avatar name={member.name} avatarUrl={member.avatarUrl} size={18} />
          {member.name}
        </button>
      ))}
    </div>
  )
}
