import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { fetchCircleMembers } from '@famlin/api-client';
import { Avatar } from '@/components/Avatar';
import './CircleMembersModal.css';

// Who is in this circle — reachable from the "shared in <Circle>" badge on a
// post, which is exactly where a reader wonders "so who actually saw this?".
//
// This is the transparency half of the circle privacy model, not a
// convenience. Admins are NOT implicit members of a circle and can't read its
// content, but they CAN add themselves to one — so the guarantee members
// actually get is "nobody reads this silently", and that only holds if the
// membership is somewhere a member can look. Showing when each person joined
// is the point: a name that appeared last week is visible as such.
//
// The server returns 404 for a circle the caller isn't in, so there's no
// separate permission check here — a non-member never gets a badge to click
// in the first place.
export function CircleMembersModal({
  circleId,
  circleName,
  onClose,
}: {
  circleId: string;
  circleName: string;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();

  const membersQuery = useQuery({
    queryKey: ['circle-members', circleId],
    queryFn: () => fetchCircleMembers(circleId),
  });

  const members = membersQuery.data ?? [];

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal>
      <div className="modal-card circle-members-card" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-title">{circleName}</h2>
        <p className="circle-members-hint">{t('circles.membersHint')}</p>

        {membersQuery.isLoading && <div className="circle-members-state">{t('common.loading')}</div>}

        {membersQuery.isError && (
          <div className="circle-members-state">{t('circles.membersLoadFailed')}</div>
        )}

        {membersQuery.isSuccess && (
          <ul className="circle-members-list">
            {members.map((member) => (
              <li key={member.id} className="circle-members-row">
                <Avatar name={member.name} avatarUrl={member.avatarUrl} size={36} />
                <span className="circle-members-info">
                  <span className="circle-members-name">{member.name}</span>
                  <span className="circle-members-joined">
                    {t('circles.joinedOn', {
                      date: new Date(member.joinedAt).toLocaleDateString(i18n.language),
                    })}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
