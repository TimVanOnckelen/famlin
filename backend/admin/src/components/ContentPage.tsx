import { Tabs, TabsList, TabsTrigger } from '@famlin/ui/tabs'
import { InitialAvatar } from '@/components/common/InitialAvatar'
import { StateMessage } from '@famlin/ui/common/state-message'
import { PageHeader } from '@famlin/ui/common/page-header'
import { Textarea } from '@famlin/ui/textarea'
import { Button } from '@famlin/ui/button'
import { Card } from '@famlin/ui/card'
import { Input } from '@famlin/ui/input'
import { SelectField } from '@famlin/ui/common/select-field'
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@famlin/ui/table'
import { Badge } from '@famlin/ui/badge'
import { AdminModal } from './AdminModal'
import { useAdminDialogs } from './AdminDialogs'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, ApiError, Group, ModerationComment, ModerationPost, ModerationStory, User } from '../api/client'
import i18n from '../i18n'
import { Icon } from './Icon'

type Tab = 'posts' | 'comments' | 'stories'

function truncate(text: string | null, length = 90) {
  if (!text) return ''
  return text.length > length ? `${text.slice(0, length)}…` : text
}

function AuthorCell({ name, avatarUrl }: { name: string; avatarUrl: string | null }) {
  return (
    <span className="cell-person">
      <InitialAvatar name={name} avatarUrl={avatarUrl} className="size-8" />
      <span className="cell-name">{name}</span>
    </span>
  )
}

// Story photos live under /uploads/, which needs the bearer token — so the
// thumbnail is fetched with it and shown from an object URL.
function StoryThumb({ imageUrl }: { imageUrl: string }) {
  const { t } = useTranslation()
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    let objectUrl: string | null = null
    let cancelled = false
    api
      .fetchUploadObjectUrl(imageUrl.replace(/\.[a-z]+$/, '-thumbnail.jpg'))
      .then((url) => {
        objectUrl = url
        if (!cancelled) setSrc(url)
      })
      .catch(() => {})
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [imageUrl])

  return src ? (
    <img src={src} alt={t('content.storyPhoto')} className="story-thumb" />
  ) : (
    <span className="story-thumb story-thumb-empty" aria-label={t('content.storyPhoto')} />
  )
}

// Text-only moderation edit (fixing a typo, removing something hurtful) —
// photos are edited from the member-facing apps. Edits only this one post,
// never a cross-posted copy in another family (moderation is per-group).
function EditPostDialog({
  post,
  onClose,
  onSaved,
}: {
  post: ModerationPost
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useTranslation()
  const [content, setContent] = useState(post.content ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await api.updatePostContent(post.id, content.trim())
      onSaved()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.error'))
      setSaving(false)
    }
  }

  return (
    <AdminModal
      title={
        <span className="inline-flex items-center gap-3">
          <InitialAvatar name={post.author.name} avatarUrl={post.author.avatarUrl} />
          {t('content.editPostTitle', { name: post.author.name })}
        </span>
      }
      onClose={onClose}
      busy={saving}
    >
      <form onSubmit={submit}>
        <label>
          {t('content.table.content')}
          <Textarea value={content} onChange={(e) => setContent(e.target.value)} rows={6} maxLength={5000} autoFocus />
        </label>
        <p className="hint">{t('content.editPostHint')}</p>
        {error && (
          <StateMessage variant="error" className="error">
            {error}
          </StateMessage>
        )}
        <div className="modal-actions">
          <Button variant="secondary" type="button" className="secondary" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={saving || !content.trim()}>
            {t('common.save')}
          </Button>
        </div>
      </form>
    </AdminModal>
  )
}

function DateCell({ iso }: { iso: string }) {
  const date = new Date(iso)
  return (
    <span className="muted" title={date.toLocaleString(i18n.language)}>
      {date.toLocaleDateString(i18n.language)}
    </span>
  )
}

export function ContentPage() {
  const { t } = useTranslation()
  const dialogs = useAdminDialogs()
  const [tab, setTab] = useState<Tab>('posts')
  const [groups, setGroups] = useState<Group[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [groupId, setGroupId] = useState('')
  const [authorId, setAuthorId] = useState('')
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [posts, setPosts] = useState<ModerationPost[]>([])
  const [comments, setComments] = useState<ModerationComment[]>([])
  const [stories, setStories] = useState<ModerationStory[]>([])
  const [editingPost, setEditingPost] = useState<ModerationPost | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetching, setFetching] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  // Filters can change while a fetch is in flight; only the newest request
  // may write its result, otherwise a slow stale response overwrites it.
  const requestIdRef = useRef(0)

  useEffect(() => {
    api.getGroups().then(setGroups)
    api.getAllUsers().then(setUsers)
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), 300)
    return () => clearTimeout(timer)
  }, [search])

  const filterParams = {
    groupId: groupId || undefined,
    authorId: authorId || undefined,
    q: q || undefined,
  }

  const load = async () => {
    const requestId = ++requestIdRef.current
    setFetching(true)
    try {
      if (tab === 'posts') {
        const page = await api.getContentPosts(filterParams)
        if (requestId !== requestIdRef.current) return
        setPosts(page.items)
        setNextCursor(page.nextCursor)
      } else if (tab === 'comments') {
        const page = await api.getContentComments(filterParams)
        if (requestId !== requestIdRef.current) return
        setComments(page.items)
        setNextCursor(page.nextCursor)
      } else {
        const page = await api.getContentStories(filterParams)
        if (requestId !== requestIdRef.current) return
        setStories(page.items)
        setNextCursor(page.nextCursor)
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setFetching(false)
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, groupId, authorId, q])

  const loadMore = async () => {
    if (!nextCursor) return
    const requestId = requestIdRef.current
    setLoadingMore(true)
    try {
      const params = { ...filterParams, cursor: nextCursor }
      if (tab === 'posts') {
        const page = await api.getContentPosts(params)
        if (requestId !== requestIdRef.current) return
        setPosts((current) => [...current, ...page.items])
        setNextCursor(page.nextCursor)
      } else if (tab === 'comments') {
        const page = await api.getContentComments(params)
        if (requestId !== requestIdRef.current) return
        setComments((current) => [...current, ...page.items])
        setNextCursor(page.nextCursor)
      } else {
        const page = await api.getContentStories(params)
        if (requestId !== requestIdRef.current) return
        setStories((current) => [...current, ...page.items])
        setNextCursor(page.nextCursor)
      }
    } finally {
      setLoadingMore(false)
    }
  }

  const hasFilters = Boolean(search || groupId || authorId)

  const clearFilters = () => {
    setSearch('')
    setQ('')
    setGroupId('')
    setAuthorId('')
  }

  const handleDeletePost = async (post: ModerationPost) => {
    if (!(await dialogs.confirmAction(t('content.deleteConfirm')))) return
    try {
      await api.deletePost(post.id)
      load()
    } catch (error) {
      await dialogs.showMessage(error instanceof Error ? error.message : t('common.error'))
    }
  }

  const handleRetriggerPush = async (post: ModerationPost) => {
    try {
      const result = await api.retriggerPostPush(post.id)
      await dialogs.showMessage(t('content.retriggerPushResult', { ...result }))
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('common.error')
      await dialogs.showMessage(t('content.retriggerPushError', { error: message }))
    }
  }

  const handleDeleteComment = async (comment: ModerationComment) => {
    if (!(await dialogs.confirmAction(t('content.deleteConfirm')))) return
    try {
      await api.deleteComment(comment.id)
      load()
    } catch (error) {
      await dialogs.showMessage(error instanceof Error ? error.message : t('common.error'))
    }
  }

  const handleDeleteStory = async (story: ModerationStory) => {
    if (!(await dialogs.confirmAction(t('content.deleteConfirm')))) return
    try {
      await api.deleteStory(story.id)
      load()
    } catch (error) {
      await dialogs.showMessage(error instanceof Error ? error.message : t('common.error'))
    }
  }

  const items = tab === 'posts' ? posts : tab === 'comments' ? comments : stories
  const emptyMessage = hasFilters
    ? t('content.noResults')
    : tab === 'posts'
      ? t('content.noPosts')
      : tab === 'comments'
        ? t('content.noComments')
        : t('content.noStories')

  return (
    <>
      <PageHeader
        title={t('content.title')}
        actions={
          <>
            <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
              <TabsList aria-label={t('content.title')}>
                <TabsTrigger value="posts">
                  <Icon name="image" />
                  {t('content.tabPosts')}
                </TabsTrigger>
                <TabsTrigger value="comments">
                  <Icon name="message-circle" />
                  {t('content.tabComments')}
                </TabsTrigger>
                <TabsTrigger value="stories">
                  <Icon name="clock" />
                  {t('content.tabStories')}
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </>
        }
      />

      <Card
        key={tab}
        className="p-6 gap-4 animate-in fade-in-0 slide-in-from-bottom-1 duration-200 motion-reduce:animate-none"
      >
        <div className="content-toolbar">
          {/* Stories are photos — there is no text to search. */}
          {tab !== 'stories' && (
            <div className="search-field">
              <span className="search-icon">
                <Icon name="search" size={15} />
              </span>
              <Input
                className="pl-9"
                type="search"
                placeholder={t('content.searchPlaceholder')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          )}
          <SelectField
            aria-label={t('content.allGroups')}
            className="w-full sm:w-auto sm:min-w-40"
            value={groupId}
            onValueChange={(value) => setGroupId(value)}
            items={[
              { value: '', label: <>{t('content.allGroups')}</> },
              ...groups.map((g) => ({ value: g.id, label: <>{g.name}</> })),
            ]}
          />
          <SelectField
            aria-label={t('content.allAuthors')}
            className="w-full sm:w-auto sm:min-w-40"
            value={authorId}
            onValueChange={(value) => setAuthorId(value)}
            items={[
              { value: '', label: <>{t('content.allAuthors')}</> },
              ...users.map((u) => ({
                value: u.id,
                label: (
                  <span className="flex items-center gap-2">
                    <InitialAvatar name={u.name} avatarUrl={u.avatarUrl} className="size-6" />
                    {u.name}
                  </span>
                ),
              })),
            ]}
          />
          {hasFilters && (
            <Button variant="link" className="link-button" onClick={clearFilters}>
              {t('content.clearFilters')}
            </Button>
          )}
        </div>

        {loading ? (
          <StateMessage variant="loading" className="loading">
            {t('common.loading')}
          </StateMessage>
        ) : items.length === 0 ? (
          <StateMessage variant="empty" className="empty">
            {emptyMessage}
          </StateMessage>
        ) : (
          <div className={`content-table${fetching ? ' refreshing' : ''}`}>
            {tab === 'posts' ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('content.table.author')}</TableHead>
                    <TableHead>{t('content.table.content')}</TableHead>
                    <TableHead>{t('content.table.group')}</TableHead>
                    <TableHead>{t('content.table.activity')}</TableHead>
                    <TableHead>{t('content.table.date')}</TableHead>
                    <TableHead>{t('content.table.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {posts.map((post) => (
                    <TableRow key={post.id}>
                      <TableCell>
                        <AuthorCell name={post.author.name} avatarUrl={post.author.avatarUrl} />
                      </TableCell>
                      <TableCell className="cell-content">
                        {post.type === 'MILESTONE' && <Badge variant="milestone">{t('content.milestone')}</Badge>}
                        {post.content ? truncate(post.content) : <span className="muted">{t('content.noText')}</span>}
                      </TableCell>
                      <TableCell>
                        <div className="group-badges">
                          <Badge variant="secondary" className="badge">
                            {post.group.name}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="activity-counts">
                          <span title={t('content.commentsTooltip')}>
                            <Icon name="message-circle" size={13} />
                            {post.commentCount}
                          </span>
                          <span title={t('content.likesTooltip')}>
                            <Icon name="heart" size={13} />
                            {post.likeCount}
                          </span>
                        </span>
                      </TableCell>
                      <TableCell>
                        <DateCell iso={post.createdAt} />
                      </TableCell>
                      <TableCell className="actions">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="icon-button"
                          title={t('content.retriggerPush')}
                          aria-label={t('content.retriggerPush')}
                          onClick={() => handleRetriggerPush(post)}
                        >
                          <Icon name="bell" size={15} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="icon-button"
                          title={t('common.edit')}
                          aria-label={t('common.edit')}
                          onClick={() => setEditingPost(post)}
                        >
                          <Icon name="edit" size={15} />
                        </Button>
                        <Button
                          variant="destructive"
                          size="icon"
                          className="icon-button danger"
                          title={t('common.delete')}
                          aria-label={t('common.delete')}
                          onClick={() => handleDeletePost(post)}
                        >
                          <Icon name="trash" size={15} />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : tab === 'stories' ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('content.table.author')}</TableHead>
                    <TableHead>{t('content.table.content')}</TableHead>
                    <TableHead>{t('content.table.group')}</TableHead>
                    <TableHead>{t('content.table.activity')}</TableHead>
                    <TableHead>{t('content.table.date')}</TableHead>
                    <TableHead>{t('content.table.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stories.map((story) => (
                    <TableRow key={story.id}>
                      <TableCell>
                        <AuthorCell name={story.author.name} avatarUrl={story.author.avatarUrl} />
                      </TableCell>
                      <TableCell className="cell-content">
                        <span className="story-cell">
                          <StoryThumb imageUrl={story.imageUrl} />
                          {story.pinnedAt ? (
                            <Badge variant="milestone">{t('content.storyHighlight')}</Badge>
                          ) : (
                            <span className="muted">
                              {t('content.storyLive', {
                                time: new Date(story.expiresAt).toLocaleString(i18n.language),
                              })}
                            </span>
                          )}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="group-badges">
                          <Badge variant="secondary" className="badge">
                            {story.group.name}
                          </Badge>
                          {story.circleId && (
                            <Badge variant="secondary" className="badge">
                              {t('content.storyCircle')}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="activity-counts">
                          <span title={t('content.viewsTooltip')}>
                            <Icon name="eye" size={13} />
                            {story.viewCount}
                          </span>
                          <span title={t('content.reactionsTooltip')}>
                            <Icon name="heart" size={13} />
                            {story.reactionCount}
                          </span>
                        </span>
                      </TableCell>
                      <TableCell>
                        <DateCell iso={story.createdAt} />
                      </TableCell>
                      <TableCell className="actions">
                        <Button
                          variant="destructive"
                          size="icon"
                          className="icon-button danger"
                          title={t('common.delete')}
                          aria-label={t('common.delete')}
                          onClick={() => handleDeleteStory(story)}
                        >
                          <Icon name="trash" size={15} />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('content.table.author')}</TableHead>
                    <TableHead>{t('content.table.comment')}</TableHead>
                    <TableHead>{t('content.table.onPost')}</TableHead>
                    <TableHead>{t('content.table.group')}</TableHead>
                    <TableHead>{t('content.table.date')}</TableHead>
                    <TableHead>{t('content.table.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {comments.map((comment) => (
                    <TableRow key={comment.id}>
                      <TableCell>
                        <AuthorCell name={comment.author.name} avatarUrl={comment.author.avatarUrl} />
                      </TableCell>
                      <TableCell className="cell-content">{truncate(comment.content)}</TableCell>
                      <TableCell className="cell-content">
                        {comment.post.content ? (
                          <span className="cell-sub">{truncate(comment.post.content, 60)}</span>
                        ) : (
                          <span className="muted">{t('content.noText')}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="group-badges">
                          <Badge variant="secondary" className="badge">
                            {comment.post.group.name}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell>
                        <DateCell iso={comment.createdAt} />
                      </TableCell>
                      <TableCell className="actions">
                        <Button
                          variant="destructive"
                          size="icon"
                          className="icon-button danger"
                          title={t('common.delete')}
                          aria-label={t('common.delete')}
                          onClick={() => handleDeleteComment(comment)}
                        >
                          <Icon name="trash" size={15} />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        )}
        {!loading && nextCursor && (
          <div className="load-more">
            <Button variant="secondary" className="secondary" disabled={loadingMore} onClick={loadMore}>
              {loadingMore ? t('common.loading') : t('common.loadMore')}
            </Button>
          </div>
        )}
      </Card>
      {editingPost && (
        <EditPostDialog
          post={editingPost}
          onClose={() => setEditingPost(null)}
          onSaved={() => {
            setEditingPost(null)
            load()
          }}
        />
      )}
    </>
  )
}
