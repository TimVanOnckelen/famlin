import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Post } from '@famlin/api-client';
import { Icon } from '@/components/Icon';
import { CircleMembersModal } from '@/components/CircleMembersModal';

// "Shared in Grandparents" — the marker that tells a reader this post went to
// a Circle rather than the whole family.
//
// It only ever renders for people who can already see the post: the server
// returns `circle` exclusively on posts that passed the circle check, and
// omits circle posts entirely for everyone else. So this reveals nothing on
// its own — there is no client-side privacy decision being made here.
//
// Clicking it opens the circle's member list. That's deliberate rather than
// decorative: an admin isn't an implicit member of a circle and can't read
// its content, but they can add themselves to one, so what members actually
// get is "nobody reads this silently" — which only means something if the
// membership is somewhere they can look.
export function CircleBadge({ post }: { post: Post }) {
  const { t } = useTranslation();
  const [membersOpen, setMembersOpen] = useState(false);

  if (!post.circle) return null;

  const circle = post.circle;

  return (
    <>
      <button
        type="button"
        className="post-circle-chip"
        onClick={() => setMembersOpen(true)}
        title={t('circles.whoCanSee', { circle: circle.name })}
        aria-label={t('circles.whoCanSee', { circle: circle.name })}
      >
        <Icon name="users" size={11} strokeWidth={2.5} />
        {circle.name}
      </button>

      {membersOpen && (
        <CircleMembersModal
          circleId={circle.id}
          circleName={circle.name}
          onClose={() => setMembersOpen(false)}
        />
      )}
    </>
  );
}
