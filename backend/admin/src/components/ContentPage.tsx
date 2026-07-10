import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, Group, ModerationComment, ModerationPost, User } from '../api/client';
import i18n from '../i18n';
import { avatarColor, initials } from '../avatar';
import { Icon } from './Icon';

type Tab = 'posts' | 'comments';

function truncate(text: string | null, length = 90) {
  if (!text) return '';
  return text.length > length ? `${text.slice(0, length)}…` : text;
}

function AuthorCell({ name }: { name: string }) {
  return (
    <span className="cell-person">
      <span className="avatar avatar-sm" style={{ background: avatarColor(name) }}>
        {initials(name)}
      </span>
      <span className="cell-name">{name}</span>
    </span>
  );
}

function DateCell({ iso }: { iso: string }) {
  const date = new Date(iso);
  return (
    <span className="muted" title={date.toLocaleString(i18n.language)}>
      {date.toLocaleDateString(i18n.language)}
    </span>
  );
}

export function ContentPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('posts');
  const [groups, setGroups] = useState<Group[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [groupId, setGroupId] = useState('');
  const [authorId, setAuthorId] = useState('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [posts, setPosts] = useState<ModerationPost[]>([]);
  const [comments, setComments] = useState<ModerationComment[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // Filters can change while a fetch is in flight; only the newest request
  // may write its result, otherwise a slow stale response overwrites it.
  const requestIdRef = useRef(0);

  useEffect(() => {
    api.getGroups().then(setGroups);
    api.getAllUsers().then(setUsers);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const filterParams = {
    groupId: groupId || undefined,
    authorId: authorId || undefined,
    q: q || undefined,
  };

  const load = async () => {
    const requestId = ++requestIdRef.current;
    setFetching(true);
    try {
      if (tab === 'posts') {
        const page = await api.getContentPosts(filterParams);
        if (requestId !== requestIdRef.current) return;
        setPosts(page.items);
        setNextCursor(page.nextCursor);
      } else {
        const page = await api.getContentComments(filterParams);
        if (requestId !== requestIdRef.current) return;
        setComments(page.items);
        setNextCursor(page.nextCursor);
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setFetching(false);
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, groupId, authorId, q]);

  const loadMore = async () => {
    if (!nextCursor) return;
    const requestId = requestIdRef.current;
    setLoadingMore(true);
    try {
      const params = { ...filterParams, cursor: nextCursor };
      if (tab === 'posts') {
        const page = await api.getContentPosts(params);
        if (requestId !== requestIdRef.current) return;
        setPosts((current) => [...current, ...page.items]);
        setNextCursor(page.nextCursor);
      } else {
        const page = await api.getContentComments(params);
        if (requestId !== requestIdRef.current) return;
        setComments((current) => [...current, ...page.items]);
        setNextCursor(page.nextCursor);
      }
    } finally {
      setLoadingMore(false);
    }
  };

  const hasFilters = Boolean(search || groupId || authorId);

  const clearFilters = () => {
    setSearch('');
    setQ('');
    setGroupId('');
    setAuthorId('');
  };

  const handleDeletePost = async (post: ModerationPost) => {
    if (!confirm(t('content.deleteConfirm'))) return;
    await api.deletePost(post.id);
    load();
  };

  const handleDeleteComment = async (comment: ModerationComment) => {
    if (!confirm(t('content.deleteConfirm'))) return;
    await api.deleteComment(comment.id);
    load();
  };

  const items = tab === 'posts' ? posts : comments;
  const emptyMessage = hasFilters
    ? t('content.noResults')
    : tab === 'posts'
      ? t('content.noPosts')
      : t('content.noComments');

  return (
    <>
      <div className="page-header">
        <h2>{t('content.title')}</h2>
        <div className="seg-tabs">
          <button
            className={`seg-tab${tab === 'posts' ? ' active' : ''}`}
            onClick={() => setTab('posts')}
          >
            <Icon name="image" size={14} />
            {t('content.tabPosts')}
          </button>
          <button
            className={`seg-tab${tab === 'comments' ? ' active' : ''}`}
            onClick={() => setTab('comments')}
          >
            <Icon name="message-circle" size={14} />
            {t('content.tabComments')}
          </button>
        </div>
      </div>

      <div className="card">
        <div className="content-toolbar">
          <div className="search-field">
            <span className="search-icon">
              <Icon name="search" size={15} />
            </span>
            <input
              type="search"
              placeholder={t('content.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            <option value="">{t('content.allGroups')}</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <select value={authorId} onChange={(e) => setAuthorId(e.target.value)}>
            <option value="">{t('content.allAuthors')}</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          {hasFilters && (
            <button className="link-button" onClick={clearFilters}>
              {t('content.clearFilters')}
            </button>
          )}
        </div>

        {loading ? (
          <div className="loading">{t('common.loading')}</div>
        ) : items.length === 0 ? (
          <div className="empty">{emptyMessage}</div>
        ) : (
          <div className={`content-table${fetching ? ' refreshing' : ''}`}>
            {tab === 'posts' ? (
              <table>
                <thead>
                  <tr>
                    <th>{t('content.table.author')}</th>
                    <th>{t('content.table.content')}</th>
                    <th>{t('content.table.group')}</th>
                    <th>{t('content.table.activity')}</th>
                    <th>{t('content.table.date')}</th>
                    <th>{t('content.table.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {posts.map((post) => (
                    <tr key={post.id}>
                      <td>
                        <AuthorCell name={post.author.name} />
                      </td>
                      <td className="cell-content">
                        {post.type === 'MILESTONE' && (
                          <span className="badge milestone">{t('content.milestone')}</span>
                        )}
                        {post.content ? (
                          truncate(post.content)
                        ) : (
                          <span className="muted">{t('content.noText')}</span>
                        )}
                      </td>
                      <td>
                        <div className="group-badges">
                          <span className="badge">{post.group.name}</span>
                        </div>
                      </td>
                      <td>
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
                      </td>
                      <td>
                        <DateCell iso={post.createdAt} />
                      </td>
                      <td className="actions">
                        <button
                          className="icon-button danger"
                          title={t('common.delete')}
                          aria-label={t('common.delete')}
                          onClick={() => handleDeletePost(post)}
                        >
                          <Icon name="trash" size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>{t('content.table.author')}</th>
                    <th>{t('content.table.comment')}</th>
                    <th>{t('content.table.onPost')}</th>
                    <th>{t('content.table.group')}</th>
                    <th>{t('content.table.date')}</th>
                    <th>{t('content.table.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {comments.map((comment) => (
                    <tr key={comment.id}>
                      <td>
                        <AuthorCell name={comment.author.name} />
                      </td>
                      <td className="cell-content">{truncate(comment.content)}</td>
                      <td className="cell-content">
                        {comment.post.content ? (
                          <span className="cell-sub">{truncate(comment.post.content, 60)}</span>
                        ) : (
                          <span className="muted">{t('content.noText')}</span>
                        )}
                      </td>
                      <td>
                        <div className="group-badges">
                          <span className="badge">{comment.post.group.name}</span>
                        </div>
                      </td>
                      <td>
                        <DateCell iso={comment.createdAt} />
                      </td>
                      <td className="actions">
                        <button
                          className="icon-button danger"
                          title={t('common.delete')}
                          aria-label={t('common.delete')}
                          onClick={() => handleDeleteComment(comment)}
                        >
                          <Icon name="trash" size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
        {!loading && nextCursor && (
          <div className="load-more">
            <button className="secondary" disabled={loadingMore} onClick={loadMore}>
              {loadingMore ? t('common.loading') : t('common.loadMore')}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
