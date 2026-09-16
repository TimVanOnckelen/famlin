import { useTranslation } from 'react-i18next';
import { Post } from '@famlin/api-client';
import { Icon } from '@/components/Icon';

// "Shared in Grandparents" — the marker that tells a reader this post went to
// a Circle rather than the whole family.
//
// It only ever renders for people who can already see the post: the server
// returns `circle` exclusively on posts that passed the circle check, and
// omits circle posts entirely for everyone else. So this reveals nothing on
// its own — there is no client-side privacy decision being made here.
export function CircleBadge({ post }: { post: Post }) {
  const { t } = useTranslation();

  if (!post.circle) return null;

  return (
    <span className="post-circle-chip" title={t('feed.sharedWithCircle', { circle: post.circle.name })}>
      <Icon name="users" size={11} strokeWidth={2.5} />
      {post.circle.name}
    </span>
  );
}
