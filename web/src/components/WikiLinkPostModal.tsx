import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { fetchPosts, searchPosts, wikiPostLabel, type Post } from '@famlin/api-client'
import { Avatar } from '@/components/Avatar'
import { Icon } from '@/components/Icon'
import { useModalFocus } from '@/hooks/useModalFocus'
import { formatRelativeDate } from '@/utils/time'
import './NewPostModal.css'

// The wiki editor's "Link a post" picker (issue #118): the family's recent
// posts, or a search over them, and picking one hands it back to be inserted
// as a Markdown link (wikiPostLinkMarkdown). Only posts the caller can see are
// listed — and a reader of the page who can't see the post still can't open it.
export function WikiLinkPostModal({
  groupId,
  onPick,
  onClose,
}: {
  groupId: string
  onPick: (post: Post, label: string) => void
  onClose: () => void
}) {
  const { t, i18n } = useTranslation()
  const cardRef = useRef<HTMLDivElement>(null)
  useModalFocus(cardRef, onClose)

  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 300)
    return () => clearTimeout(timer)
  }, [query])

  const postsQuery = useQuery({
    queryKey: ['wiki', 'link-posts', groupId, debounced],
    queryFn: () => (debounced ? searchPosts({ groupId, q: debounced }) : fetchPosts({ groupIds: [groupId] })),
  })
  const posts = postsQuery.data?.items ?? []

  const labelOf = (post: Post) =>
    wikiPostLabel(post, t('wiki.postFrom', { date: new Date(post.createdAt).toLocaleDateString(i18n.language) }))

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={cardRef}
        className="modal-card wiki-link-modal"
        role="dialog"
        aria-modal
        aria-labelledby="wiki-link-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="wiki-link-title" className="modal-title">
          {t('wiki.linkPostTitle')}
        </h2>
        <label className="wiki-search">
          <Icon name="search" size={20} />
          <input
            type="search"
            value={query}
            maxLength={200}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={t('wiki.linkPostSearch')}
            placeholder={t('wiki.linkPostSearch')}
          />
        </label>
        <div role="status" aria-live="polite" className="wiki-hint">
          {postsQuery.isLoading || query.trim() !== debounced
            ? t('common.loading')
            : postsQuery.isError
              ? t('wiki.linkPostFailed')
              : !posts.length
                ? t('wiki.linkPostEmpty')
                : null}
        </div>
        {posts.length > 0 && query.trim() === debounced && (
          <ul className="wiki-link-list">
            {posts.map((post) => {
              const label = labelOf(post)
              return (
                <li key={post.id}>
                  <button type="button" className="wiki-link-row" onClick={() => onPick(post, label)}>
                    <Avatar name={post.author.name} avatarUrl={post.author.avatarUrl} size={32} />
                    <span className="wiki-row-body">
                      <span className="wiki-row-title">{label}</span>
                      <span className="wiki-row-meta">
                        {post.author.name} · {formatRelativeDate(post.createdAt, i18n.language)}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  )
}
