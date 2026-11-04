import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { fetchGroups, fetchWikiCategories, fetchWikiPages, type WikiPageSummary } from '@famlin/api-client'
import { WikiMeta, WikiShell, type WikiShellProps } from '@/components/WikiShell'
import { Icon } from '@/components/Icon'
import { ScreenHeader } from '@/components/ScreenHeader'
import type { WikiFilters } from '@/utils/routes'
import './FeedPage.css'
import './WikiPages.css'

// The Family Wiki overview (issue #118): one family's wiki at a time, its
// categories as filter chips, a search box, and the pages — most recently
// updated first. Family, search and category live in the URL (App.tsx).
export function WikiHomePage({
  groupId,
  query,
  category,
  onFiltersChange,
  onOpenPage,
  onNewPage,
  ...shell
}: WikiShellProps & {
  groupId: string
  query: string
  category: string | undefined
  onFiltersChange: (filters: WikiFilters) => void
  onOpenPage: (pageId: string) => void
  onNewPage: (groupId: string, category?: string | null) => void
}) {
  const { t } = useTranslation()
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
    if (familyId && familyId !== groupId) onFiltersChange({ groupId: familyId, q: query, category })
  }, [familyId, groupId, query, category, onFiltersChange])

  const categoriesQuery = useQuery({
    queryKey: ['wiki', 'categories', familyId],
    queryFn: () => fetchWikiCategories(familyId!),
    enabled: !!familyId,
  })
  const pagesQuery = useInfiniteQuery({
    queryKey: ['wiki', 'pages', familyId, debouncedQuery, category ?? null],
    queryFn: ({ pageParam }) =>
      fetchWikiPages({
        groupId: familyId!,
        q: debouncedQuery || undefined,
        category,
        cursor: pageParam ?? undefined,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: !!familyId,
  })
  const pages = pagesQuery.data?.pages.flatMap((page) => page.items) ?? []
  const typing = query.trim() !== debouncedQuery
  const categories = categoriesQuery.data ?? []
  const filtering = !!debouncedQuery || category !== undefined

  const setFilters = (next: Partial<WikiFilters>) =>
    onFiltersChange({ groupId: familyId ?? '', q: query, category, ...next })

  return (
    <WikiShell shell={shell}>
      <div className="wiki-column">
        <div className="wiki-title-row">
          <ScreenHeader title={t('wiki.title')} />
          {family && (
            <button type="button" className="btn btn-primary" onClick={() => onNewPage(family.id, category || null)}>
              <Icon name="plus" size={16} color="white" strokeWidth={2.5} />
              {t('wiki.newPage')}
            </button>
          )}
        </div>
        <p className="wiki-intro">{t('wiki.intro')}</p>

        {groups.length > 1 && (
          <div className="feed-filter" role="group" aria-label={t('wiki.family')}>
            {groups.map((group) => (
              <button
                key={group.id}
                type="button"
                className={`filter-chip${family?.id === group.id ? ' filter-chip-active' : ''}`}
                aria-pressed={family?.id === group.id}
                onClick={() => onFiltersChange({ groupId: group.id })}
              >
                {group.name}
              </button>
            ))}
          </div>
        )}

        <label className="wiki-search">
          <Icon name="search" size={20} />
          <input
            type="search"
            maxLength={200}
            value={query}
            onChange={(event) => setFilters({ q: event.target.value })}
            aria-label={t('wiki.searchPlaceholder')}
            placeholder={t('wiki.searchPlaceholder')}
            disabled={!family}
          />
        </label>

        {categories.length > 0 && (
          <div className="feed-filter" role="group" aria-label={t('wiki.categories')}>
            <button
              type="button"
              className={`filter-chip${category === undefined ? ' filter-chip-active' : ''}`}
              aria-pressed={category === undefined}
              onClick={() => setFilters({ category: undefined })}
            >
              {t('wiki.allCategories')}
            </button>
            {categories.map((c) => {
              const value = c.name ?? ''
              const active = category !== undefined && category.toLowerCase() === value.toLowerCase()
              return (
                <button
                  key={value || '\u0000'}
                  type="button"
                  className={`filter-chip${active ? ' filter-chip-active' : ''}`}
                  aria-pressed={active}
                  onClick={() => setFilters({ category: value })}
                >
                  {c.name ?? t('wiki.uncategorized')} <span className="wiki-chip-count">{c.pageCount}</span>
                </button>
              )
            })}
          </div>
        )}

        <h2 className="wiki-section-title">{filtering ? t('wiki.results') : t('wiki.recentlyUpdated')}</h2>

        <div aria-live="polite" role="status" className="wiki-hint">
          {groupsQuery.isLoading || typing || pagesQuery.isLoading
            ? t('common.loading')
            : groupsQuery.isSuccess && !groups.length
              ? t('wiki.noGroups')
              : pagesQuery.isSuccess && !pages.length
                ? filtering
                  ? t('wiki.noResults')
                  : t('wiki.empty')
                : null}
        </div>
        {(groupsQuery.isError || pagesQuery.isError) && (
          <div className="wiki-hint" role="alert">
            {t('wiki.loadFailed')}{' '}
            <button
              className="btn btn-secondary"
              onClick={() => (groupsQuery.isError ? groupsQuery.refetch() : pagesQuery.refetch())}
            >
              {t('common.retry')}
            </button>
          </div>
        )}

        {!typing && pages.length > 0 && (
          <ul className="wiki-list">
            {pages.map((page) => (
              <li key={page.id}>
                <WikiPageRow page={page} onOpen={() => onOpenPage(page.id)} />
              </li>
            ))}
          </ul>
        )}
        {!typing && pagesQuery.hasNextPage && (
          <button
            className="btn btn-secondary wiki-load-more"
            onClick={() => pagesQuery.fetchNextPage()}
            disabled={pagesQuery.isFetchingNextPage}
          >
            {pagesQuery.isFetchingNextPage ? t('common.loading') : t('wiki.loadMore')}
          </button>
        )}
      </div>
    </WikiShell>
  )
}

function WikiPageRow({ page, onOpen }: { page: WikiPageSummary; onOpen: () => void }) {
  return (
    <button type="button" className="wiki-row" onClick={onOpen}>
      <span className="wiki-row-emoji" aria-hidden>
        {page.emoji || '📄'}
      </span>
      <span className="wiki-row-body">
        <span className="wiki-row-title">{page.title}</span>
        {page.excerpt && <span className="wiki-row-excerpt">{page.excerpt}</span>}
        <WikiMeta page={page} className="wiki-row-meta" />
      </span>
    </button>
  )
}
