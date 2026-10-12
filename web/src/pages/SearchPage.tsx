import { useEffect, useState, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { fetchGroups, searchPosts, type Post, type User } from '@famlin/api-client'
import { AppShell } from '@/components/AppShell'
import { Icon } from '@/components/Icon'
import { PostCard } from '@/components/PostCard'
import { ScreenHeader } from '@/components/ScreenHeader'
import { useOpenPostModal } from '@/utils/routes'
import './FeedPage.css'
import './SearchPage.css'

export function SearchPage({
  user,
  query,
  groupId,
  onSearchChange,
  onOpenFeed,
  onOpenProfile,
  onOpenPhotos,
  onOpenChat,
  onOpenFavorites,
  onOpenNotifications,
  onOpenTrip,
  onOpenAlbum,
  onLogout,
}: {
  user: User
  query: string
  groupId: string
  onSearchChange: (query: string, groupId: string) => void
  onOpenFeed: () => void
  onOpenProfile: () => void
  onOpenPhotos?: () => void
  onOpenChat?: () => void
  onOpenFavorites?: () => void
  onOpenNotifications?: () => void
  onOpenTrip?: (id: string) => void
  onOpenAlbum?: (id: string) => void
  onLogout: () => void
}) {
  const { t } = useTranslation()
  const openPostModal = useOpenPostModal()
  const groupsQuery = useQuery({ queryKey: ['groups'], queryFn: fetchGroups })
  const groups = groupsQuery.data ?? []
  const family = groups.find((group) => group.id === groupId) ?? groups[0]
  const familyId = family?.id
  const [debouncedQuery, setDebouncedQuery] = useState(query.trim())
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 300)
    return () => clearTimeout(timer)
  }, [query])
  useEffect(() => {
    if (familyId && familyId !== groupId) onSearchChange(query, familyId)
  }, [familyId, groupId, query, onSearchChange])
  const resultsQuery = useInfiniteQuery({
    queryKey: ['posts', 'search', family?.id, debouncedQuery],
    queryFn: ({ pageParam }) => searchPosts({ groupId: family!.id, q: debouncedQuery, cursor: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: !!family && !!debouncedQuery && query.trim() === debouncedQuery,
  })
  const posts = resultsQuery.data?.pages.flatMap((page) => page.items) ?? []
  const typing = query.trim() !== debouncedQuery
  function openPost(event: MouseEvent<HTMLDivElement>, post: Post) {
    const target = (event.target as HTMLElement).closest(
      'button, a, input, textarea, select, video, [role="menu"], .shimmer-frame'
    )
    if (target && !target.classList.contains('post-comments-btn')) return
    if (post.type === 'TRIP') onOpenTrip?.(post.id)
    else if (post.type === 'ALBUM') onOpenAlbum?.(post.id)
    else openPostModal(post.id)
  }
  return (
    <AppShell
      user={user}
      active="search"
      onSearch={() => {}}
      onFeed={onOpenFeed}
      onPhotos={onOpenPhotos}
      onChat={onOpenChat}
      onFavorites={onOpenFavorites}
      onNotifications={onOpenNotifications}
      onProfile={onOpenProfile}
      onLogout={onLogout}
    >
      <div className="search-column">
        <ScreenHeader title={t('search.title')} />
        <div className="feed-filter" role="group" aria-label={t('search.family')}>
          {groups.map((group) => (
            <button
              key={group.id}
              type="button"
              className={`filter-chip${family?.id === group.id ? ' filter-chip-active' : ''}`}
              aria-pressed={family?.id === group.id}
              onClick={() => onSearchChange(query, group.id)}
            >
              {group.name}
            </button>
          ))}
        </div>
        <div className="search-controls">
          <label className="search-input-wrap">
            <Icon name="search" size={20} />
            <input
              type="search"
              maxLength={200}
              value={query}
              onChange={(event) => onSearchChange(event.target.value, family?.id ?? '')}
              aria-label={t('search.placeholder')}
              placeholder={t('search.placeholder')}
              disabled={!family}
            />
          </label>
        </div>
        <div aria-live="polite" role="status" className="search-hint">
          {groupsQuery.isLoading
            ? t('common.loading')
            : groupsQuery.isSuccess && !groups.length
              ? t('search.noGroups')
              : !query.trim()
                ? t('search.prompt')
                : typing || resultsQuery.isLoading
                  ? t('common.loading')
                  : resultsQuery.isSuccess && !posts.length
                    ? t('search.empty')
                    : null}
        </div>
        {(groupsQuery.isError || (!typing && resultsQuery.isError)) && (
          <div className="search-hint" role="alert">
            {t('search.loadFailed')}{' '}
            <button
              className="btn btn-secondary"
              onClick={() => (groupsQuery.isError ? groupsQuery.refetch() : resultsQuery.refetch())}
            >
              {t('common.retry')}
            </button>
          </div>
        )}
        {!typing && query.trim() && posts.length > 0 && (
          <div className="search-results">
            {posts.map((post) => (
              <div key={post.id} role="article" onClick={(event) => openPost(event, post)}>
                <PostCard post={post} showGroup onOpenTrip={onOpenTrip} onOpenAlbum={onOpenAlbum} />
              </div>
            ))}
          </div>
        )}
        {!typing && resultsQuery.hasNextPage && (
          <button
            className="btn btn-secondary search-load-more"
            onClick={() => resultsQuery.fetchNextPage()}
            disabled={resultsQuery.isFetchingNextPage}
          >
            {resultsQuery.isFetchingNextPage ? t('common.loading') : t('search.loadMore')}
          </button>
        )}
      </div>
    </AppShell>
  )
}
