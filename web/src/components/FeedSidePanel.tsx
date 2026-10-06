import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { fetchGroupMembers, fetchOnThisDay } from '@famlin/api-client';
import { Avatar } from '@/components/Avatar';
import { Icon } from '@/components/Icon';
import './FeedSidePanel.css';

// Large-screen-only extra content (≥1200px — see .feed-side-panel in
// FeedPage.css), filling the space a single centered feed column leaves
// empty: "On this day" (mirrors mobile FeedScreen's onThisDayBanner) and the
// selected family's member list (mirrors the sidebar member button mobile's
// FeedScreen header shows). Both only have one clear target when the family
// filter narrows to exactly one group — same rule mobile's FeedScreen uses
// for its own onThisDay/members affordances — so this renders nothing at all
// when several (or no) families are selected, and hides either section on
// its own if it comes back empty.
export function FeedSidePanel({
  groupId,
  onOpenPost,
}: {
  groupId: string;
  onOpenPost: (postId: string) => void;
}) {
  const { t } = useTranslation();

  const onThisDayQuery = useQuery({
    queryKey: ['onThisDay', groupId],
    queryFn: () => fetchOnThisDay(groupId),
  });
  const membersQuery = useQuery({
    queryKey: ['group-members', groupId],
    queryFn: () => fetchGroupMembers(groupId),
  });

  const onThisDay = onThisDayQuery.data ?? [];
  const members = membersQuery.data ?? [];

  if (onThisDay.length === 0 && members.length === 0) return null;

  return (
    <aside className="feed-side-panel" aria-label={t('feed.sidePanelLabel')}>
      {onThisDay.length > 0 && (
        <section className="side-panel-section">
          <h2 className="side-panel-title">{t('feed.onThisDayTitle')}</h2>
          <button
            type="button"
            className="side-panel-on-this-day"
            onClick={() => onOpenPost(onThisDay[0].id)}
          >
            <span className="side-panel-on-this-day-icon" aria-hidden>
              <Icon name="clock" size={18} />
            </span>
            <span className="side-panel-on-this-day-count">
              {t('feed.onThisDayCount', { count: onThisDay.length })}
            </span>
          </button>
        </section>
      )}

      {members.length > 0 && (
        <section className="side-panel-section">
          <h2 className="side-panel-title">{t('feed.membersTitle')}</h2>
          <ul className="side-panel-members">
            {members.map((member) => (
              <li key={member.id} className="side-panel-member">
                <Avatar name={member.name} avatarUrl={member.avatarUrl} size={32} />
                <span>{member.name}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}
