import { type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useInfiniteQuery } from '@tanstack/react-query';
import { fetchFavorites, Post, User } from '@famlin/api-client';
import { Icon } from '@/components/Icon';
import { AppShell } from '@/components/AppShell';
import { PostCard } from '@/components/PostCard';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useOpenPostModal } from '@/utils/routes';
import './FavoritesPage.css';

// Same delegated-click rule as the feed (see FeedPage.tsx): everything
// interactive inside PostCard handles itself; a click on the plain card body
// — or deliberately on the comment-count button — opens the post detail.
const CARD_INTERACTIVE_SELECTOR = 'button, a, input, textarea, select, video, [role="menu"], .shimmer-frame';

// Web counterpart of mobile's FavoritesScreen (issue #207): the caller's
// favorited posts across all their families, so cards always carry the group
// tag. Reached from the sidebar (wide) / compact header (narrow) rather than
// as a drill-in, so — like ProfilePage — it has a title bar but no back
// button; `onBack` only feeds AppShell's feed tab.
export function FavoritesPage({
  user,
  onBack,
  onOpenProfile,
  onOpenPhotos,
  onOpenChat,
  onOpenTrip,
  onOpenAlbum,
  onLogout,
}: {
  user: User;
  onBack: () => void;
  onOpenProfile: () => void;
  onOpenPhotos?: () => void;
  onOpenChat?: () => void;
  onOpenTrip?: (postId: string) => void;
  onOpenAlbum?: (postId: string) => void;
  onLogout: () => void;
}) {
  const { t } = useTranslation();
  const openPostModal = useOpenPostModal();

  const favoritesQuery = useInfiniteQuery({
    queryKey: ['favorites'],
    queryFn: ({ pageParam }) => fetchFavorites(pageParam ?? undefined),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
  const posts = favoritesQuery.data?.pages.flatMap((page) => page.items) ?? [];

  // Where a card click should go: trips and albums keep opening their own
  // pages, everything else opens the detail modal over this page.
  function openPost(post: Post) {
    if (post.type === 'TRIP') onOpenTrip?.(post.id);
    else if (post.type === 'ALBUM') onOpenAlbum?.(post.id);
    else openPostModal(post.id);
  }

  function onCardClick(e: MouseEvent<HTMLDivElement>, post: Post) {
    const interactive = (e.target as HTMLElement).closest(CARD_INTERACTIVE_SELECTOR);
    if (interactive && !interactive.classList.contains('post-comments-btn')) return;
    openPost(post);
  }

  return (
    <AppShell
      user={user}
      active="favorites"
      onFeed={onBack}
      onPhotos={onOpenPhotos}
      onChat={onOpenChat}
      onFavorites={() => {}}
      onProfile={onOpenProfile}
      onLogout={onLogout}
    >
      <div className="favorites-column">
        <ScreenHeader title={t('favorites.title')} />

        {favoritesQuery.isLoading && <div className="favorites-hint">{t('common.loading')}</div>}

        {favoritesQuery.isError && (
          <div className="favorites-hint">
            {t('favorites.loadFailed')}{' '}
            <button className="favorites-retry" onClick={() => favoritesQuery.refetch()}>
              {t('common.retry')}
            </button>
          </div>
        )}

        {favoritesQuery.isSuccess && posts.length === 0 && (
          <div className="favorites-empty">
            <div className="favorites-empty-icon" aria-hidden>
              <Icon name="bookmark" size={40} strokeWidth={1.5} />
            </div>
            <p className="favorites-empty-title">{t('favorites.emptyTitle')}</p>
            <p className="favorites-empty-subtitle">{t('favorites.emptySubtitle')}</p>
          </div>
        )}

        {posts.length > 0 && (
          <div className="favorites-list">
            {posts.map((post) => (
              <div key={post.id} className="favorites-card" role="article" onClick={(e) => onCardClick(e, post)}>
                <PostCard post={post} showGroup onOpenTrip={onOpenTrip} onOpenAlbum={onOpenAlbum} />
              </div>
            ))}
          </div>
        )}

        {favoritesQuery.hasNextPage && (
          <button
            className="btn btn-secondary favorites-load-more"
            onClick={() => favoritesQuery.fetchNextPage()}
            disabled={favoritesQuery.isFetchingNextPage}
          >
            {favoritesQuery.isFetchingNextPage ? t('common.loading') : t('favorites.loadMore')}
          </button>
        )}
      </div>
    </AppShell>
  );
}
