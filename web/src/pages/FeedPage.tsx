import { useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { fetchGroups, fetchMyCircles, fetchPosts, Post, User } from '@famlin/api-client';
import { Icon } from '@/components/Icon';
import { AppShell } from '@/components/AppShell';
import { PostCard } from '@/components/PostCard';
import { NewPostModal } from '@/components/NewPostModal';
import { StoryTray } from '@/components/StoryTray';
import { FeedSidePanel } from '@/components/FeedSidePanel';
import { useFeedKeyboardNav } from '@/hooks/useFeedKeyboardNav';
import { useQuickPostActions } from '@/hooks/usePostMutations';
import { useOpenPostModal } from '@/utils/routes';
import { formatRelativeDate } from '@/utils/time';
import './FeedPage.css';

// A click anywhere on a feed card opens the post detail, *except* on another
// interactive child — reactions, photos/the lightbox, the permalink/circle
// links, poll options. Every one of those is already a <button>/<a>/<video>
// in PostCard/TripFeedCard/AlbumFeedCard (or, for the single-photo hero, the
// `.shimmer-frame` span ShimmerImage attaches its own onClick to) — so
// `closest()` against this one selector is enough to tell them apart from
// plain card content, with no changes needed in those files. The one
// deliberate exception is PostCard's comment-count button
// (`.post-comments-btn`): it's a <button> too, but clicking it should open
// the detail just like the rest of the card body, so it's excluded from the
// skip list by class name.
const CARD_INTERACTIVE_SELECTOR = 'button, a, input, textarea, select, video, [role="menu"], .shimmer-frame';

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
  const { t, i18n } = useTranslation();
  // The feed is a filter over the user's families: empty selection = all of
  // them (the backend scopes to memberships), one or more = just those.
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  // Circles narrow the feed further, to just those circles' posts. Kept in
  // its own state (rather than mixed into selectedGroupIds) because the two
  // filters mean different things: groups widen the pool, circles narrow it.
  const [selectedCircleIds, setSelectedCircleIds] = useState<string[]>([]);
  const [composerOpen, setComposerOpen] = useState(false);

  const openPostModal = useOpenPostModal();
  const { likeToggle, favoriteToggle } = useQuickPostActions();

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

  // Stories follow the same family filter. Only fetched when at least one
  // selected family has them turned on (an older server without stories
  // reports no storiesEnabled at all, which reads as off).
  const storyGroups = selectedGroupIds.length > 0 ? groups.filter((g) => selectedGroupIds.includes(g.id)) : groups;
  const storiesEnabled = storyGroups.some((g) => g.storiesEnabled);

  // The side panel (On this day / family members) and card group-labels only
  // have one clear target when the family filter narrows to exactly one —
  // mirrors mobile FeedScreen's singleActiveGroup.
  const effectiveGroupIds = selectedGroupIds.length > 0 ? selectedGroupIds : groups.map((g) => g.id);
  const singleActiveGroup =
    effectiveGroupIds.length === 1 ? groups.find((g) => g.id === effectiveGroupIds[0]) : undefined;
  const showGroupOnCards = effectiveGroupIds.length > 1;

  // Where "o"/Enter/a card click should go: trips and albums keep opening
  // their own richer pages, everything else opens the detail modal over the
  // feed.
  function openPost(post: Post) {
    if (post.type === 'TRIP') onOpenTrip?.(post.id);
    else if (post.type === 'ALBUM') onOpenAlbum?.(post.id);
    else openPostModal(post.id);
  }

  const { registerCard } = useFeedKeyboardNav({
    postIds: posts.map((p) => p.id),
    onOpen: (id) => {
      const post = posts.find((p) => p.id === id);
      if (post) openPost(post);
    },
    onLike: (id) => {
      const post = posts.find((p) => p.id === id);
      if (post) likeToggle(post);
    },
    onFavorite: (id) => {
      const post = posts.find((p) => p.id === id);
      if (post) favoriteToggle(post);
    },
  });

  function onCardClick(e: MouseEvent<HTMLDivElement>, post: Post) {
    const interactive = (e.target as HTMLElement).closest(CARD_INTERACTIVE_SELECTOR);
    if (interactive && !interactive.classList.contains('post-comments-btn')) return;
    openPost(post);
  }

  return (
    <AppShell
      user={user}
      active="feed"
      onFeed={() => {}}
      onPhotos={onOpenPhotos}
      onChat={onOpenChat}
      onProfile={onOpenProfile}
      onNewPost={() => setComposerOpen(true)}
      onLogout={onLogout}
    >
      <div className="feed-layout">
        <div className="feed-column">
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

          <StoryTray groupIds={selectedGroupIds} enabled={storiesEnabled} />

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
                <div
                  key={post.id}
                  ref={(el) => registerCard(post.id, el)}
                  className="feed-card"
                  tabIndex={0}
                  role="article"
                  aria-label={t('feed.postCardLabel', {
                    author: post.author.name,
                    time: formatRelativeDate(post.createdAt, i18n.language),
                  })}
                  onClick={(e) => onCardClick(e, post)}
                >
                  <PostCard post={post} showGroup={showGroupOnCards} onOpenTrip={onOpenTrip} onOpenAlbum={onOpenAlbum} />
                </div>
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
        </div>

        {singleActiveGroup && <FeedSidePanel groupId={singleActiveGroup.id} onOpenPost={openPostModal} />}
      </div>

      {composerOpen && (
        <NewPostModal
          groups={groups}
          defaultGroupId={composerDefaultGroupId}
          onClose={() => setComposerOpen(false)}
        />
      )}
    </AppShell>
  );
}
