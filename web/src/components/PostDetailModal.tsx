import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { fetchPost, getUploadUrl } from '@famlin/api-client';
import { Icon } from '@/components/Icon';
import { PostCard } from '@/components/PostCard';
import { Lightbox } from '@/components/Lightbox';
import { ShimmerImage } from '@/components/ShimmerImage';
import { useModalFocus } from '@/hooks/useModalFocus';
import { isVideoUrl } from '@/utils/media';
import './PostDetailModal.css';

// The feed's post-detail view (phase 2 of the web redesign): opened over the
// feed as a large modal via react-router's background-location pattern (see
// App.tsx) rather than a full page navigation, so Esc/backdrop/close just
// goes back to the feed underneath. A direct load or refresh of /posts/:id
// has no background location and renders PostDetailPage (the full page)
// instead — this component is only ever reached by an in-app click.
//
// Trip and album posts keep their own richer pages (TripDetailPage/
// AlbumDetailPage) — same redirect PostDetailPage does — so this never
// shows a trip/album in two-pane form.
export function PostDetailModal({
  postId,
  onClose,
  onOpenTrip,
  onOpenAlbum,
}: {
  postId: string;
  onClose: () => void;
  onOpenTrip?: (postId: string) => void;
  onOpenAlbum?: (postId: string) => void;
}) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalFocus(dialogRef, onClose);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  // One photo at a time in the media pane, like mobile's swipeable viewer;
  // ←/→ step through it (unless focus is in the comment composer).
  const [mediaIndex, setMediaIndex] = useState(0);

  // Same ['post', postId] key PostDetailPage/TripDetailPage/AlbumDetailPage
  // use, and the one patchPostInCaches updates, so reactions/favorites made
  // here or on the feed stay in sync.
  const postQuery = useQuery({ queryKey: ['post', postId], queryFn: () => fetchPost(postId) });
  const post = postQuery.data;

  useEffect(() => {
    if (post?.type === 'TRIP' && onOpenTrip) onOpenTrip(post.id);
    else if (post?.type === 'ALBUM' && onOpenAlbum) onOpenAlbum(post.id);
  }, [post?.id, post?.type, onOpenTrip, onOpenAlbum]);

  // The API answers 404 (or 403) for a post that doesn't exist *or* that the
  // viewer can't see — deliberately indistinguishable, so this is too.
  const notFound =
    axios.isAxiosError(postQuery.error) &&
    (postQuery.error.response?.status === 404 || postQuery.error.response?.status === 403);

  const hasMedia = !!post && post.uploadedAssetUrls.length > 0 && post.type !== 'TRIP' && post.type !== 'ALBUM';
  const mediaCount = hasMedia ? post.uploadedAssetUrls.length : 0;

  useEffect(() => {
    if (mediaCount < 2 || lightboxIndex !== null) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.closest('input, textarea, [contenteditable="true"]'))) return;
      if (e.key === 'ArrowLeft') setMediaIndex((i) => Math.max(0, i - 1));
      else if (e.key === 'ArrowRight') setMediaIndex((i) => Math.min(mediaCount - 1, i + 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mediaCount, lightboxIndex]);

  return (
    <div className="modal-overlay post-detail-overlay" onClick={onClose}>
      <div
        className={`post-detail-modal${hasMedia ? ' post-detail-modal-with-media' : ''}`}
        ref={dialogRef}
        role="dialog"
        aria-modal
        aria-label={t('postDetail.title')}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="post-detail-modal-close"
          onClick={onClose}
          aria-label={t('common.close')}
        >
          <Icon name="x" size={20} strokeWidth={2.5} />
        </button>

        {postQuery.isLoading && <div className="post-detail-hint">{t('common.loading')}</div>}

        {notFound && (
          <div className="post-detail-hint">
            <p>{t('postDetail.notFound')}</p>
          </div>
        )}

        {!postQuery.isLoading && !notFound && !post && (
          <div className="post-detail-hint">
            {t('postDetail.loadFailed')}{' '}
            <button type="button" className="post-detail-retry" onClick={() => postQuery.refetch()}>
              {t('common.retry')}
            </button>
          </div>
        )}

        {post && hasMedia && (
          <div className="post-detail-modal-media">
            {(() => {
              const urls = post.uploadedAssetUrls;
              const url = urls[mediaIndex] ?? urls[0];
              return (
                <>
                  {isVideoUrl(url) ? (
                    <video key={url} src={getUploadUrl(url)} className="post-detail-modal-media-item" controls preload="metadata" />
                  ) : (
                    <ShimmerImage
                      key={url}
                      src={getUploadUrl(url)}
                      className="post-detail-modal-media-item"
                      onClick={() => setLightboxIndex(mediaIndex)}
                    />
                  )}
                  {urls.length > 1 && (
                    <>
                      <button
                        type="button"
                        className="post-detail-media-nav post-detail-media-prev"
                        aria-label={t('postDetail.prevPhoto')}
                        disabled={mediaIndex === 0}
                        onClick={() => setMediaIndex((i) => Math.max(0, i - 1))}
                      >
                        <Icon name="chevron-left" size={22} />
                      </button>
                      <button
                        type="button"
                        className="post-detail-media-nav post-detail-media-next"
                        aria-label={t('postDetail.nextPhoto')}
                        disabled={mediaIndex === urls.length - 1}
                        onClick={() => setMediaIndex((i) => Math.min(urls.length - 1, i + 1))}
                      >
                        <Icon name="chevron-right" size={22} />
                      </button>
                      <span className="post-detail-media-counter">
                        {mediaIndex + 1} / {urls.length}
                      </span>
                    </>
                  )}
                </>
              );
            })()}
          </div>
        )}

        {post && (
          <div className={`post-detail-modal-body${hasMedia ? ' post-detail-modal-body-with-media' : ''}`}>
            <PostCard post={post} showGroup showComments onOpenTrip={onOpenTrip} onOpenAlbum={onOpenAlbum} />
          </div>
        )}
      </div>

      {post && lightboxIndex !== null && (
        <Lightbox
          assetUrls={post.uploadedAssetUrls}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </div>
  );
}
