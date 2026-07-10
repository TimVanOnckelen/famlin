import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { fetchGroups, fetchPosts, User } from '@famlin/api-client';
import { AppHeader } from '@/components/AppHeader';
import { PostCard } from '@/components/PostCard';
import { NewPostModal } from '@/components/NewPostModal';
import { ApiTokensModal } from '@/components/ApiTokensModal';
import './FeedPage.css';

export function FeedPage({
  user,
  onOpenProfile,
  onOpenPhotos,
  onLogout,
}: {
  user: User;
  onOpenProfile: () => void;
  onOpenPhotos?: () => void;
  onLogout: () => void;
}) {
  const { t } = useTranslation();
  // The feed is a filter over the user's families: empty selection = all of
  // them (the backend scopes to memberships), one or more = just those.
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [composerOpen, setComposerOpen] = useState(false);
  const [apiTokensOpen, setApiTokensOpen] = useState(false);

  const groupsQuery = useQuery({ queryKey: ['groups'], queryFn: fetchGroups });
  const groups = groupsQuery.data ?? [];

  function toggleGroup(groupId: string) {
    setSelectedGroupIds((prev) =>
      prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId]
    );
  }

  const postsQuery = useInfiniteQuery({
    // Key shape must stay ['posts', ...] — patchPostInCaches targets it.
    queryKey: ['posts', [...selectedGroupIds].sort().join(',') || 'all'],
    queryFn: ({ pageParam }) =>
      fetchPosts({ groupIds: selectedGroupIds, cursor: pageParam ?? undefined }),
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
            <div className="feed-empty-emoji">📸</div>
            <p>{t('feed.empty')}</p>
            <button className="btn btn-primary" onClick={() => setComposerOpen(true)}>
              {t('feed.newPost')}
            </button>
          </div>
        )}

        {posts.length > 0 && (
          <div className="feed-grid">
            {posts.map((post) => (
              <PostCard key={post.id} post={post} showGroup={showGroupOnCards} />
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
