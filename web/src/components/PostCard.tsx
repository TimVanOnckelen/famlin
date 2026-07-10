import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Post,
  ReactionType,
  REACTION_TYPES,
  reactToPost,
  toggleFavoritePost,
  getUploadUrl,
  patchPostInCaches,
} from '@famlin/api-client';
import { REACTION_EMOJI } from '@/constants/reactions';
import { Avatar } from '@/components/Avatar';
import { CommentsSection } from '@/components/CommentsSection';
import { formatRelativeDate } from '@/utils/time';
import { isVideoUrl } from '@/utils/media';
import './PostCard.css';

function Lightbox({
  assetUrls,
  initialIndex,
  onClose,
}: {
  assetUrls: string[];
  initialIndex: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(initialIndex);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1));
      if (e.key === 'ArrowRight') setIndex((i) => Math.min(assetUrls.length - 1, i + 1));
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [assetUrls.length, onClose]);

  const url = getUploadUrl(assetUrls[index]);

  return (
    <div className="lightbox" onClick={onClose} role="dialog" aria-modal>
      {index > 0 && (
        <button
          className="lightbox-nav lightbox-prev"
          onClick={(e) => {
            e.stopPropagation();
            setIndex(index - 1);
          }}
          aria-label="‹"
        >
          ‹
        </button>
      )}
      {isVideoUrl(assetUrls[index]) ? (
        <video src={url} className="lightbox-media" controls autoPlay onClick={(e) => e.stopPropagation()} />
      ) : (
        <img src={url} className="lightbox-media" alt="" onClick={(e) => e.stopPropagation()} />
      )}
      {index < assetUrls.length - 1 && (
        <button
          className="lightbox-nav lightbox-next"
          onClick={(e) => {
            e.stopPropagation();
            setIndex(index + 1);
          }}
          aria-label="›"
        >
          ›
        </button>
      )}
    </div>
  );
}

export function PostCard({ post, showGroup = false }: { post: Post; showGroup?: boolean }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const isMilestone = post.type === 'MILESTONE';
  const hasPhotos = post.uploadedAssetUrls.length > 0;
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const reactMutation = useMutation({
    mutationFn: (type: ReactionType) => reactToPost(post.id, type),
    onMutate: async (type) => {
      await queryClient.cancelQueries({ queryKey: ['posts'] });
      const nextReaction = post.myReaction === type ? null : type;
      patchPostInCaches(queryClient, post.id, (p) => {
        const reactions = { ...p.reactions };
        if (p.myReaction) reactions[p.myReaction] = Math.max(0, (reactions[p.myReaction] || 0) - 1);
        if (nextReaction) reactions[nextReaction] = (reactions[nextReaction] || 0) + 1;
        return {
          ...p,
          myReaction: nextReaction,
          reactions,
          likeCount: Object.values(reactions).reduce((sum, n) => sum + (n || 0), 0),
          likedByMe: nextReaction !== null,
        };
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['posts'] });
    },
  });

  const favoriteMutation = useMutation({
    mutationFn: () => toggleFavoritePost(post.id),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['posts'] });
      const nextFavorited = !post.favoritedByMe;
      patchPostInCaches(queryClient, post.id, (p) => ({ ...p, favoritedByMe: nextFavorited }));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['posts'] });
      queryClient.invalidateQueries({ queryKey: ['favorites'] });
    },
  });

  const timeLine = `${formatRelativeDate(post.createdAt, i18n.language)}${
    post.editedAt ? ` · ${t('common.edited')}` : ''
  }`;
  // When the feed spans several families, label each post with its group.
  const groupChip = showGroup && post.group && <span className="post-group-chip">{post.group.name}</span>;

  // The styleguide's photo-first rule: with a photo, the photo leads —
  // edge-to-edge hero with the author chip (and milestone title) on top of it.
  const heroUrl = hasPhotos ? getUploadUrl(post.uploadedAssetUrls[0]) : null;
  const extraAssets = post.uploadedAssetUrls.slice(1);
  const visibleExtra = extraAssets.slice(0, 3);

  const favoriteButton = (
    <button
      className={`icon-btn favorite-btn${post.favoritedByMe ? ' favorite-btn-active' : ''}${hasPhotos ? ' favorite-btn-overlay' : ''}`}
      onClick={() => favoriteMutation.mutate()}
      disabled={favoriteMutation.isPending}
      aria-label={t('feed.favorite')}
      title={t('feed.favorite')}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill={post.favoritedByMe ? 'currentColor' : 'none'} aria-hidden>
        <path
          d="M19 21l-7-4.5L5 21V5a2 2 0 012-2h10a2 2 0 012 2z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );

  return (
    <article className="post-card">
      {isMilestone && <span className="post-pin" aria-hidden />}
      {hasPhotos && !isMilestone && <span className="post-tape" aria-hidden />}
      <div className={`post-card-inner${isMilestone && !hasPhotos ? ' post-card-milestone' : ''}`}>
        {hasPhotos && heroUrl && (
          <div className="post-hero">
            {isVideoUrl(post.uploadedAssetUrls[0]) ? (
              <video src={heroUrl} className="post-hero-media" controls preload="metadata" />
            ) : (
              <img
                src={heroUrl}
                className="post-hero-media post-hero-clickable"
                alt=""
                loading="lazy"
                onClick={() => setLightboxIndex(0)}
              />
            )}
            <div className="post-hero-chip">
              <Avatar name={post.author.name} avatarUrl={post.author.avatarUrl} size={26} />
              <span>{post.author.name}</span>
            </div>
            {isMilestone && (
              <span className="milestone-badge milestone-badge-overlay">{t('feed.milestoneBadge')}</span>
            )}
            {favoriteButton}
            {isMilestone && post.content && (
              <div className="post-hero-scrim">
                <div className="post-hero-title">{post.content}</div>
              </div>
            )}
          </div>
        )}

        {visibleExtra.length > 0 && (
          <div className="post-thumbs">
            {visibleExtra.map((assetUrl, i) => (
              <button key={assetUrl} className="post-thumb" onClick={() => setLightboxIndex(i + 1)}>
                {isVideoUrl(assetUrl) ? (
                  <video src={getUploadUrl(assetUrl)} preload="metadata" />
                ) : (
                  <img src={getUploadUrl(assetUrl)} alt="" loading="lazy" />
                )}
                {i === 2 && extraAssets.length > 3 && (
                  <span className="post-thumb-more">+{extraAssets.length - 3}</span>
                )}
              </button>
            ))}
          </div>
        )}

        <div className="post-body">
          {!hasPhotos && (
            <>
              {isMilestone && <span className="milestone-badge">{t('feed.milestoneBadge')}</span>}
              <div className="post-author-row">
                <Avatar name={post.author.name} avatarUrl={post.author.avatarUrl} size={44} />
                <div>
                  <div className="post-author-name">{post.author.name}</div>
                  <div className="post-meta">
                    <span className="post-time">{timeLine}</span>
                    {groupChip}
                  </div>
                </div>
                {favoriteButton}
              </div>
            </>
          )}

          {isMilestone && !hasPhotos && post.content && (
            <div className="post-milestone-title">{post.content}</div>
          )}
          {!isMilestone && post.content && (
            <p className={`post-content${hasPhotos ? ' post-caption' : ''}`}>{post.content}</p>
          )}
          {hasPhotos && (
            <div className="post-meta">
              <span className="post-time">{timeLine}</span>
              {groupChip}
            </div>
          )}

          <div className={`post-actions${isMilestone && !hasPhotos ? ' post-actions-milestone' : ''}`}>
            <div className="reaction-wrap">
              <button
                className={`action-btn${post.myReaction ? ' action-btn-active' : ''}`}
                onClick={() => reactMutation.mutate(post.myReaction ?? 'LOVE')}
                disabled={reactMutation.isPending}
              >
                {post.myReaction ? (
                  <span className="reaction-emoji">{REACTION_EMOJI[post.myReaction]}</span>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path
                      d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"
                      stroke="currentColor"
                      strokeWidth="2"
                    />
                  </svg>
                )}
                {post.likeCount}
              </button>
              <div className="reaction-picker" role="menu">
                {REACTION_TYPES.map((type) => (
                  <button
                    key={type}
                    className={`reaction-option${post.myReaction === type ? ' reaction-option-active' : ''}`}
                    onClick={() => reactMutation.mutate(type)}
                    aria-label={type}
                  >
                    {REACTION_EMOJI[type]}
                  </button>
                ))}
              </div>
            </div>

            <button className="action-btn" onClick={() => setCommentsOpen(!commentsOpen)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinejoin="round"
                />
              </svg>
              {t('feed.comments', { count: post.commentCount })}
            </button>
          </div>

          {commentsOpen && <CommentsSection post={post} />}
        </div>
      </div>

      {lightboxIndex !== null && (
        <Lightbox
          assetUrls={post.uploadedAssetUrls}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </article>
  );
}
