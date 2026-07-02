import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, Group, ModerationComment, ModerationPost } from '../api/client';
import i18n from '../i18n';
import { Icon } from './Icon';

type Tab = 'posts' | 'comments';

function truncate(text: string | null, length = 80) {
  if (!text) return '';
  return text.length > length ? `${text.slice(0, length)}…` : text;
}

export function ContentPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('posts');
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupId, setGroupId] = useState('');
  const [showDeleted, setShowDeleted] = useState(false);
  const [posts, setPosts] = useState<ModerationPost[]>([]);
  const [comments, setComments] = useState<ModerationComment[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getGroups().then(setGroups);
  }, []);

  const load = () => {
    setLoading(true);
    const params = { groupId: groupId || undefined, includeDeleted: showDeleted };
    const request =
      tab === 'posts'
        ? api.getContentPosts(params).then((page) => {
            setPosts(page.items);
            setNextCursor(page.nextCursor);
          })
        : api.getContentComments(params).then((page) => {
            setComments(page.items);
            setNextCursor(page.nextCursor);
          });
    request.finally(() => setLoading(false));
  };

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const params = { groupId: groupId || undefined, includeDeleted: showDeleted, cursor: nextCursor };
      if (tab === 'posts') {
        const page = await api.getContentPosts(params);
        setPosts((current) => [...current, ...page.items]);
        setNextCursor(page.nextCursor);
      } else {
        const page = await api.getContentComments(params);
        setComments((current) => [...current, ...page.items]);
        setNextCursor(page.nextCursor);
      }
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, groupId, showDeleted]);

  const handleDeletePost = async (post: ModerationPost) => {
    if (!confirm(t('content.deleteConfirm'))) return;
    await api.deletePost(post.id);
    load();
  };

  const handleRestorePost = async (post: ModerationPost) => {
    if (!confirm(t('content.restoreConfirm'))) return;
    await api.restorePost(post.id);
    load();
  };

  const handleDeleteComment = async (comment: ModerationComment) => {
    if (!confirm(t('content.deleteConfirm'))) return;
    await api.deleteComment(comment.id);
    load();
  };

  const handleRestoreComment = async (comment: ModerationComment) => {
    if (!confirm(t('content.restoreConfirm'))) return;
    await api.restoreComment(comment.id);
    load();
  };

  return (
    <>
      <div className="page-header">
        <h2>{t('content.title')}</h2>
      </div>

      <div className="card">
        <div className="row" style={{ alignItems: 'center', marginBottom: '1rem' }}>
          <button className={tab === 'posts' ? '' : 'secondary'} onClick={() => setTab('posts')}>
            {t('content.tabPosts')}
          </button>
          <button className={tab === 'comments' ? '' : 'secondary'} onClick={() => setTab('comments')}>
            {t('content.tabComments')}
          </button>
          <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            <option value="">{t('content.allGroups')}</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <label style={{ flexDirection: 'row', alignItems: 'center', gap: '0.5rem' }}>
            <input type="checkbox" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} />
            {t('content.showDeleted')}
          </label>
        </div>

        {loading ? (
          <div className="loading">{t('common.loading')}</div>
        ) : tab === 'posts' ? (
          posts.length === 0 ? (
            <div className="empty">{t('content.noPosts')}</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>{t('content.table.group')}</th>
                  <th>{t('content.table.author')}</th>
                  <th>{t('content.table.content')}</th>
                  <th>{t('content.table.date')}</th>
                  <th>{t('content.table.status')}</th>
                  <th>{t('content.table.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {posts.map((post) => (
                  <tr key={post.id}>
                    <td>{post.group.name}</td>
                    <td>{post.author.name}</td>
                    <td>{truncate(post.content)}</td>
                    <td>{new Date(post.createdAt).toLocaleDateString(i18n.language)}</td>
                    <td>
                      {post.deletedAt && post.deletedBy ? (
                        <span className="muted">
                          {t('content.deletedBy', {
                            name: post.deletedBy.name,
                            date: new Date(post.deletedAt).toLocaleDateString(i18n.language),
                          })}
                        </span>
                      ) : (
                        <span className="badge">{t('content.statusVisible')}</span>
                      )}
                    </td>
                    <td className="actions">
                      {post.deletedAt ? (
                        <button
                          className="icon-button"
                          title={t('content.restore')}
                          aria-label={t('content.restore')}
                          onClick={() => handleRestorePost(post)}
                        >
                          <Icon name="rotate-ccw" size={15} />
                        </button>
                      ) : (
                        <button
                          className="icon-button danger"
                          title={t('common.delete')}
                          aria-label={t('common.delete')}
                          onClick={() => handleDeletePost(post)}
                        >
                          <Icon name="trash" size={15} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : comments.length === 0 ? (
          <div className="empty">{t('content.noComments')}</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t('content.table.group')}</th>
                <th>{t('content.table.author')}</th>
                <th>{t('content.table.content')}</th>
                <th>{t('content.table.date')}</th>
                <th>{t('content.table.status')}</th>
                <th>{t('content.table.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {comments.map((comment) => (
                <tr key={comment.id}>
                  <td>{comment.post.group.name}</td>
                  <td>{comment.author.name}</td>
                  <td>{truncate(comment.content)}</td>
                  <td>{new Date(comment.createdAt).toLocaleDateString(i18n.language)}</td>
                  <td>
                    {comment.deletedAt && comment.deletedBy ? (
                      <span className="muted">
                        {t('content.deletedBy', {
                          name: comment.deletedBy.name,
                          date: new Date(comment.deletedAt).toLocaleDateString(i18n.language),
                        })}
                      </span>
                    ) : (
                      <span className="badge">{t('content.statusVisible')}</span>
                    )}
                  </td>
                  <td className="actions">
                    {comment.deletedAt ? (
                      <button
                        className="icon-button"
                        title={t('content.restore')}
                        aria-label={t('content.restore')}
                        onClick={() => handleRestoreComment(comment)}
                      >
                        <Icon name="rotate-ccw" size={15} />
                      </button>
                    ) : (
                      <button
                        className="icon-button danger"
                        title={t('common.delete')}
                        aria-label={t('common.delete')}
                        onClick={() => handleDeleteComment(comment)}
                      >
                        <Icon name="trash" size={15} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {nextCursor && (
          <button className="secondary" disabled={loadingMore} onClick={loadMore}>
            {loadingMore ? t('common.loading') : t('common.loadMore')}
          </button>
        )}
      </div>
    </>
  );
}
