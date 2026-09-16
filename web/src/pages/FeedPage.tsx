import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { fetchGroups, fetchMyCircles, fetchPosts, User } from '@famlin/api-client';
import { Icon } from '@/components/Icon';
import { AppHeader } from '@/components/AppHeader';
import { BottomNav } from '@/components/BottomNav';
import { PostCard } from '@/components/PostCard';
import { NewPostModal } from '@/components/NewPostModal';
import { ApiTokensModal } from '@/components/ApiTokensModal';
import './FeedPage.css';

export function FeedPage({
  user,
  onOpenProfile,
  onOpenPhotos,
  onOpenChat,
  onOpenTrip,
  onOpenAlbum,
  onLogout,
}: {
  user: User;
  onOpenProfile: () => void;
  onOpenPhotos?: () => void;
  onOpenChat?: () => void;
  onOpenTrip?: (postId: string) => void;
  onOpenAlbum?: (postId: string) => void;
  onLogout: () => void;
}) {
  const { t } = useTranslation();
  // The feed is a filter over the user's families: empty selection = all of
  // them (the backend scopes to memberships), one or more = just those.
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  // Circles narrow the feed further, to just those circles' posts. Kept in
  // its own state (rather than mixed into selectedGroupIds) because the two
  // filters mean different things: groups widen the pool, circles narrow it.
  const [selectedCircleIds, setSelectedCircleIds] = useState<string[]>([]);
  const [composerOpen, setComposerOpen] = useState(false);
  const [apiTokensOpen, setApiTokensOpen] = useState(false);

  const groupsQuery = useQuery({ queryKey: ['groups'], queryFn: fetchGroups });
  const groups = groupsQuery.data ?? [];

  // Only the circles the viewer actually belongs to ever come back — a group
  // member outside a circle never learns it exists, so there is nothing to
  // filter out here. Scoped to the single selected family when the group
  // filter narrows to one, otherwise the first family.
  const circlesGroupId = selectedGroupIds.length === 1 ? selectedGroupIds[0] : (groups[0]?.id ?? null);
  const circlesQuery = useQuery({
    queryKey: ['circles', circlesGroupId],
    queryFn: () => fetchMyCircles(circlesGroupId!),
    enabled: !!circlesGroupId,
  });
  const circles = circlesQuery.data ?? [];

  function toggleGroup(groupId: string) {
    setSelectedGroupIds((prev) =>
      prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId]
    );
    // The circle list is per-family, so a circle selected under one family
    // filter is meaningless under another — clear rather than send ids the
    // server would 403.
    setSelectedCircleIds([]);
  }

  function toggleCircle(circleId: string) {
    setSelectedCircleIds((prev) =>
      prev.includes(circleId) ? prev.filter((id) => id !== circleId) : [...prev, circleId]
    );
  }

  const postsQuery = useInfiniteQuery({
    // Key shape must stay ['posts', ...] — patchPostInCaches targets it.
    queryKey: [
      'posts',
      [...selectedGroupIds].sort().join(',') || 'all',
      [...selectedCircleIds].sort().join(',') || 'all-circles',
    ],
    queryFn: ({ pageParam }) =>
      fetchPosts({
        groupIds: selectedGroupIds,
        circleIds: selectedCircleIds,
        cursor: pageParam ?? undefined,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });

  const posts = postsQuery.data?.pages.flatMap((page) => page.items) ?? [];

  // Preselect the composer's group when the filter narrows to exactly one.
  const composerDefaultGroupId =
    selectedGroupIds.length === 1 ? selectedGroupIds[0] : (groups[0]?.id ?? null);

  // Label each card with its family whenever the feed spans more than one.
  const effectiveGroupCount = selectedGroupIds.length > 0 ? selectedGroupIds.length : groups.length;
  const showGroupOnCards = effectiveGroupCount > 1;

  return (
    <div className="feed-shell">
      <AppHeader
        user={user}
        onNewPost={() => setComposerOpen(true)}
        onProfile={onOpenProfile}
        onPhotos={onOpenPhotos}
        onChat={onOpenChat}
        onApiTokens={() => setApiTokensOpen(true)}
        onLogout={onLogout}
      />

      <main className="feed-column">
        {groups.length > 1 && (
          <div className="feed-filter" role="group" aria-label={t('feed.filterLabel')}>
            <button
              className={`filter-chip${selectedGroupIds.length === 0 ? ' filter-chip-active' : ''}`}
              onClick={() => setSelectedGroupIds([])}
            >
              {t('feed.allFamilies')}
            </button>
            {groups.map((group) => (
              <button
                key={group.id}
                className={`filter-chip${selectedGroupIds.includes(group.id) ? ' filter-chip-active' : ''}`}
                onClick={() => toggleGroup(group.id)}
                aria-pressed={selectedGroupIds.includes(group.id)}
              >
                {group.name}
              </button>
            ))}
          </div>
        )}

        {circles.length > 0 && (
          <div className="feed-filter" role="group" aria-label={t('feed.circleFilterLabel')}>
            {circles.map((circle) => (
              <button
                key={circle.id}
                className={`filter-chip filter-chip-circle${
                  selectedCircleIds.includes(circle.id) ? ' filter-chip-active' : ''
                }`}
                onClick={() => toggleCircle(circle.id)}
                aria-pressed={selectedCircleIds.includes(circle.id)}
              >
                <Icon name="users" size={13} strokeWidth={2} />
                {circle.name}
              </button>
            ))}
          </div>
        )}

        {postsQuery.isLoading && <div className="feed-hint">{t('common.loading')}</div>}

        {postsQuery.isError && (
          <div className="feed-hint">
            {t('feed.loadFailed')}{' '}
            <button className="feed-retry" onClick={() => postsQuery.refetch()}>
              {t('common.retry')}
            </button>
          </div>
        )}

        {postsQuery.isSuccess && posts.length === 0 && (
          <div className="feed-empty">
            <div className="feed-empty-icon" aria-hidden>
              <Icon name="camera" size={40} strokeWidth={1.5} />
            </div>
            <p>{t('feed.empty')}</p>
            <button className="btn btn-primary" onClick={() => setComposerOpen(true)}>
              {t('feed.newPost')}
            </button>
          </div>
        )}

        {posts.length > 0 && (
          <div className="feed-grid">
            {posts.map((post) => (
              <PostCard key={post.id} post={post} showGroup={showGroupOnCards} onOpenTrip={onOpenTrip} onOpenAlbum={onOpenAlbum} />
            ))}
          </div>
        )}

        {postsQuery.hasNextPage && (
          <button
            className="btn btn-secondary feed-load-more"
            onClick={() => postsQuery.fetchNextPage()}
            disabled={postsQuery.isFetchingNextPage}
          >
            {postsQuery.isFetchingNextPage ? t('common.loading') : t('feed.loadMore')}
          </button>
        )}
      </main>

      <BottomNav
        active="feed"
        onFeed={() => {}}
        onPhotos={onOpenPhotos}
        onChat={onOpenChat}
        onProfile={onOpenProfile}
        onNewPost={() => setComposerOpen(true)}
      />

      {composerOpen && (
        <NewPostModal
          groups={groups}
          defaultGroupId={composerDefaultGroupId}
          onClose={() => setComposerOpen(false)}
        />
      )}

      {apiTokensOpen && <ApiTokensModal onClose={() => setApiTokensOpen(false)} />}
    </div>
  );
}
