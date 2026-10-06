import { useEffect } from 'react';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { fetchPost, User } from '@famlin/api-client';
import { AppShell } from '@/components/AppShell';
import { ScreenHeader } from '@/components/ScreenHeader';
import { PostCard } from '@/components/PostCard';
import './PostDetailPage.css';

// One post on its own — the /posts/:postId permalink a post card's timestamp
// links to, and the URL people paste to each other. Renders the same
// PostCard the feed does, with its comment thread already open. Trips and
// albums already have richer pages of their own, so a permalink to one is
// handed straight to /trips/:id or /albums/:id instead. AppShell always
// keeps the Feed tab highlighted, like Trip/Album detail.
export function PostDetailPage({
  user,
  postId,
  onBack,
  onOpenFeed,
  onOpenTrip,
  onOpenAlbum,
  onOpenPhotos,
  onOpenChat,
  onOpenProfile,
  onLogout,
}: {
  user: User;
  postId: string;
  onBack: () => void;
  onOpenFeed?: () => void;
  onOpenTrip?: (postId: string) => void;
  onOpenAlbum?: (postId: string) => void;
  onOpenPhotos?: () => void;
  onOpenChat?: () => void;
  onOpenProfile?: () => void;
  onLogout: () => void;
}) {
  const { t } = useTranslation();
  // Same ['post', postId] key the trip/album pages use, and the one
  // patchPostInCaches updates, so reactions/favorites stay in sync here.
  const postQuery = useQuery({ queryKey: ['post', postId], queryFn: () => fetchPost(postId) });
  const post = postQuery.data;

  useEffect(() => {
    if (post?.type === 'TRIP' && onOpenTrip) onOpenTrip(post.id);
    else if (post?.type === 'ALBUM' && onOpenAlbum) onOpenAlbum(post.id);
  }, [post?.id, post?.type, onOpenTrip, onOpenAlbum]);

  // The API answers 404 (or 403) for a post that doesn't exist *or* that the
  // viewer can't see — deliberately indistinguishable, so the page is too.
  const notFound =
    axios.isAxiosError(postQuery.error) &&
    (postQuery.error.response?.status === 404 || postQuery.error.response?.status === 403);

  let body;
  if (postQuery.isLoading) {
    body = <div className="post-detail-hint">{t('common.loading')}</div>;
  } else if (notFound) {
    body = (
      <div className="post-detail-hint">
        <p>{t('postDetail.notFound')}</p>
        <button className="btn btn-secondary" onClick={onOpenFeed ?? onBack}>
          {t('postDetail.backToFeed')}
        </button>
      </div>
    );
  } else if (!post) {
    body = (
      <div className="post-detail-hint">
        {t('postDetail.loadFailed')}{' '}
        <button className="post-detail-retry" onClick={() => postQuery.refetch()}>
          {t('common.retry')}
        </button>
      </div>
    );
  } else {
    body = <PostCard post={post} showGroup initialCommentsOpen onOpenTrip={onOpenTrip} onOpenAlbum={onOpenAlbum} />;
  }

  return (
    <AppShell
      user={user}
      active="feed"
      onFeed={onOpenFeed ?? onBack}
      onPhotos={onOpenPhotos}
      onChat={onOpenChat}
      onProfile={onOpenProfile ?? (() => {})}
      onLogout={onLogout}
    >
      <div className="post-detail-column">
        <ScreenHeader title={t('postDetail.title')} onBack={onBack} />
        {body}
      </div>
    </AppShell>
  );
}
