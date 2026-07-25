import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { closeAlbum, fetchPost, fetchComments, getUploadUrl, patchPostInCaches } from '@famlin/api-client';
import { Avatar } from '@/components/Avatar';
import { BottomNav } from '@/components/BottomNav';
import { CommentsSection } from '@/components/CommentsSection';
import { Lightbox } from '@/components/Lightbox';
import { ShimmerImage } from '@/components/ShimmerImage';
import { AddAlbumPhotosModal } from '@/components/AddAlbumPhotosModal';
import { useAuthStore } from '@/stores/authStore';
import { isVideoUrl } from '@/utils/media';
import { collectAlbumPhotos, isAlbumDiscussionComment } from '@/utils/album';
import './AlbumDetailPage.css';

// Web's album detail — the read + contribute view of a collaborative photo
// album (opened as an App.tsx `view` state, like TripDetailPage). Unlike the
// deliberately view-only trip page, an album is inherently collaborative, so
// this page carries the contribute affordance: any group member can add
// photos, and the author can close the album. Photos live on the album's
// contribution comments (utils/album.ts splits them from ordinary comments).
export function AlbumDetailPage({
  postId,
  onBack,
  onOpenPhotos,
  onOpenChat,
  onOpenProfile,
}: {
  postId: string;
  onBack: () => void;
  onOpenPhotos?: () => void;
  onOpenChat?: () => void;
  onOpenProfile?: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const currentUserId = useAuthStore((s) => s.user?.id);
  const [lightbox, setLightbox] = useState<{ urls: string[]; index: number } | null>(null);
  const [contributeOpen, setContributeOpen] = useState(false);

  const postQuery = useQuery({ queryKey: ['post', postId], queryFn: () => fetchPost(postId) });
  const commentsQuery = useQuery({ queryKey: ['comments', postId], queryFn: () => fetchComments(postId) });

  const post = postQuery.data;
  const album = post?.album;
  const comments = commentsQuery.data ?? [];

  const photos = useMemo(() => collectAlbumPhotos(comments), [comments]);

  const closeMutation = useMutation({
    mutationFn: () => closeAlbum(postId),
    onSuccess: (updated) => {
      patchPostInCaches(queryClient, postId, () => updated);
      queryClient.invalidateQueries({ queryKey: ['posts'] });
      queryClient.invalidateQueries({ queryKey: ['post', postId] });
    },
  });

  if (postQuery.isLoading || commentsQuery.isLoading) {
    return (
      <div className="album-detail-shell">
        <main className="album-detail-column">
          <BackLink onBack={onBack} />
          <div className="album-detail-hint">{t('common.loading')}</div>
        </main>
      </div>
    );
  }

  if (!post || !album) {
    return (
      <div className="album-detail-shell">
        <main className="album-detail-column">
          <BackLink onBack={onBack} />
          <div className="album-detail-hint">{t('feed.loadFailed')}</div>
        </main>
      </div>
    );
  }

  const coverUrl = album.coverPhotoUrl || album.collagePhotoUrls[0] || null;
  const isAuthor = currentUserId === post.authorId;
  const photoUrls = photos.map((p) => p.url);

  return (
    <div className="album-detail-shell">
      <main className="album-detail-column">
        <BackLink onBack={onBack} />

        <div className="album-detail-cover">
          {coverUrl ? (
            <ShimmerImage src={getUploadUrl(coverUrl)} className="album-detail-cover-media" loading="eager" />
          ) : (
            <div className="album-detail-cover-placeholder" aria-hidden>
              🖼️
            </div>
          )}
        </div>

        <section className="album-detail-header">
          <span className={`album-badge ${album.closed ? 'album-badge-closed' : ''}`}>
            {album.closed ? t('album.detail.closedBadge') : t('album.detail.badge')}
          </span>
          <h1 className="album-detail-title">{album.title}</h1>
          {post.content && <p className="album-detail-description">{post.content}</p>}

          <div className="album-detail-stats">
            <div className="album-detail-stat">
              <div className="album-detail-stat-number">{album.photoCount}</div>
              <div className="album-detail-stat-label">{t('album.detail.statsPhotos')}</div>
            </div>
            <div className="album-detail-stat">
              <div className="album-detail-stat-number">{album.contributorCount}</div>
              <div className="album-detail-stat-label">{t('album.detail.statsContributors')}</div>
            </div>
          </div>

          {album.contributors.length > 0 && (
            <div className="album-detail-contributors" aria-label={t('album.detail.contributorsLabel')}>
              <div className="album-detail-contributors-stack">
                {album.contributors.slice(0, 6).map((contributor) => (
                  <span key={contributor.id} className="album-detail-contributor-face">
                    <Avatar name={contributor.name} avatarUrl={contributor.avatarUrl} size={26} />
                  </span>
                ))}
              </div>
              <span className="album-detail-contributors-text">
                {t('album.detail.contributedBy', { names: album.contributors.map((c) => c.name).join(', ') })}
              </span>
            </div>
          )}

          <div className="album-detail-header-actions">
            {!album.closed && (
              <button type="button" className="btn btn-primary" onClick={() => setContributeOpen(true)}>
                {t('album.detail.addPhotosCta')}
              </button>
            )}
            {isAuthor && !album.closed && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => closeMutation.mutate()}
                disabled={closeMutation.isPending}
              >
                {t('album.detail.closeCta')}
              </button>
            )}
          </div>
        </section>

        {photos.length === 0 ? (
          <div className="album-detail-empty">
            <div className="album-detail-empty-icon" aria-hidden>
              🖼️
            </div>
            <div className="album-detail-empty-title">{t('album.detail.emptyTitle')}</div>
            <div className="album-detail-empty-description">
              {album.closed ? t('album.detail.emptyClosedDescription') : t('album.detail.emptyDescription')}
            </div>
          </div>
        ) : (
          <div className="album-detail-grid">
            {photos.map((photo, index) => (
              <button
                key={`${photo.comment.id}-${photo.url}`}
                type="button"
                className="album-detail-grid-tile"
                onClick={() => setLightbox({ urls: photoUrls, index })}
                title={photo.comment.content || photo.comment.author.name}
              >
                {isVideoUrl(photo.url) ? (
                  <video src={getUploadUrl(photo.url)} muted preload="metadata" />
                ) : (
                  <ShimmerImage src={getUploadUrl(photo.url, 'thumbnail')} fallbackSrc={getUploadUrl(photo.url)} loading="lazy" />
                )}
              </button>
            ))}
          </div>
        )}

        <section className="album-detail-comments-section">
          <h2 className="album-detail-section-title">{t('album.detail.commentsSectionTitle')}</h2>
          <CommentsSection post={post} filterComments={(all) => all.filter(isAlbumDiscussionComment)} />
        </section>
      </main>

      <BottomNav active="feed" onFeed={onBack} onPhotos={onOpenPhotos} onChat={onOpenChat} onProfile={onOpenProfile ?? (() => {})} />

      {contributeOpen && <AddAlbumPhotosModal postId={postId} onClose={() => setContributeOpen(false)} />}

      {lightbox && <Lightbox assetUrls={lightbox.urls} initialIndex={lightbox.index} onClose={() => setLightbox(null)} />}
    </div>
  );
}

function BackLink({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  return (
    <button className="album-detail-back" onClick={onBack}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {t('album.detail.backToFeed')}
    </button>
  );
}
