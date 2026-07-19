import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Post,
  PostPerson,
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
import { Lightbox } from '@/components/Lightbox';
import { ShimmerImage } from '@/components/ShimmerImage';
import { postTypeRenderers } from '@/components/postTypes';
import { TripFeedCard } from '@/components/postTypes/TripFeedCard';
import { formatRelativeDate } from '@/utils/time';
import { isVideoUrl } from '@/utils/media';
import './PostCard.css';

// Multi-photo feed cards: one large tile + a stacked pair on the right (design 5a),
// the stacked pair's second tile showing "+N" once more photos exist than fit.
// Exactly two photos fall back to a plain 50/50 split since there's no third tile to stack.
function PhotoCollage({ assetUrls, onSelect }: { assetUrls: string[]; onSelect: (index: number) => void }) {
  const tile = (assetUrl: string, index: number, overlay?: ReactNode) => (
    <button key={assetUrl} className="post-collage-tile" onClick={() => onSelect(index)}>
      {isVideoUrl(assetUrl) ? (
        <video src={getUploadUrl(assetUrl)} preload="metadata" />
      ) : (
        <ShimmerImage
          src={getUploadUrl(assetUrl, 'thumbnail')}
          fallbackSrc={getUploadUrl(assetUrl)}
          loading="lazy"
        />
      )}
      {overlay}
    </button>
  );

  if (assetUrls.length === 2) {
    return (
      <div className="post-collage post-collage-2">
        {assetUrls.map((assetUrl, i) => tile(assetUrl, i))}
      </div>
    );
  }

  const stackUrls = assetUrls.slice(1, 3);
  const extraCount = assetUrls.length - 3;

  return (
    <div className="post-collage post-collage-3plus">
      <div className="post-collage-main">{tile(assetUrls[0], 0)}</div>
      {stackUrls.map((assetUrl, i) =>
        tile(
          assetUrl,
          i + 1,
          i === stackUrls.length - 1 && extraCount > 0 ? (
            <span className="post-collage-more">+{extraCount}</span>
          ) : undefined
        )
      )}
    </div>
  );
}

function PersonChip({ person }: { person: PostPerson }) {
  // Use the user's avatar/name if mapped to an account, otherwise use label
  const displayName = person.userName || person.label;
  const avatarUrl = person.userAvatarUrl;

  if (avatarUrl) {
    const src = avatarUrl.startsWith('/') ? getUploadUrl(avatarUrl) : avatarUrl;
    return (
      <div className="post-person-chip" title={displayName}>
        <img src={src} alt={displayName} className="post-person-avatar" />
        <span>{person.label}</span>
      </div>
    );
  }

  // Fallback avatar with first letter of the label when no image
  const firstLetter = person.label.charAt(0).toUpperCase();
  const AVATAR_COLORS = ['#006e94', '#ed835e', '#4b8b5a', '#005480'];
  let hash = 0;
  for (let i = 0; i < person.label.length; i++) {
    hash = (hash * 31 + person.label.charCodeAt(i)) | 0;
  }
  const bgColor = AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];

  return (
    <div className="post-person-chip" title={displayName}>
      <div
        className="post-person-avatar"
        style={{
          background: bgColor,
          color: 'white',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '11px',
          fontWeight: 800,
        }}
      >
        {firstLetter}
      </div>
      <span>{person.label}</span>
    </div>
  );
}

export function PostCard({
  post,
  showGroup = false,
  onOpenTrip,
}: {
  post: Post;
  showGroup?: boolean;
  onOpenTrip?: (postId: string) => void;
}) {
  // TRIP posts get a wholesale-different card (different hero source, no
  // inline comments, a "follow/view diary" CTA instead of a comment button)
  // — delegate before any of the generic hero/comments rendering below runs,
  // the same precedent as mobile's PostCard. Check-in comments must never
  // surface in a generic inline comment list, which this branch guarantees
  // simply by never mounting CommentsSection for a TRIP post.
  if (post.type === 'TRIP') {
    return <TripFeedCard post={post} showGroup={showGroup} onOpenTrip={onOpenTrip} />;
  }

  return <DefaultPostCard post={post} showGroup={showGroup} />;
}

function DefaultPostCard({ post, showGroup = false }: { post: Post; showGroup?: boolean }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const isMilestone = post.type === 'MILESTONE';
  const hasPhotos = post.uploadedAssetUrls.length > 0;
  // Unknown/absent types fall back to the plain rendering below (required
  // forward-compat behavior); milestone stays its own hardcoded branch and is
  // never looked up here.
  const TypeCardBody = postTypeRenderers[post.type]?.CardBody;
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

  // Only present (and only ever sent to the author) when the post was
  // cross-posted to more than one family — never derive this for posts
  // without the field, since other members never learn a post was shared.
  const sharedWithNames =
    post.sharedWithGroups && post.sharedWithGroups.length > 1
      ? post.sharedWithGroups.map((g) => g.name).join(', ')
      : null;

  // The styleguide's photo-first rule: with a photo, the photo leads —
  // edge-to-edge hero with the author chip (and milestone title) on top of it.
  const heroUrl = hasPhotos ? getUploadUrl(post.uploadedAssetUrls[0]) : null;
  const isCollage = post.uploadedAssetUrls.length > 1;

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
            {isCollage ? (
              <PhotoCollage assetUrls={post.uploadedAssetUrls} onSelect={setLightboxIndex} />
            ) : isVideoUrl(post.uploadedAssetUrls[0]) ? (
              <video src={heroUrl} className="post-hero-media" controls preload="metadata" />
            ) : (
              <ShimmerImage
                src={heroUrl}
                className="post-hero-media post-hero-clickable"
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
            <div className="post-hero-top-right">
              {isCollage && (
                <span className="post-photo-count-badge">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <rect x="3" y="5" width="18" height="14" rx="2.5" stroke="white" strokeWidth="2" />
                    <circle cx="8.5" cy="10" r="1.5" fill="white" />
                    <path d="M21 15l-5-5-9 9" stroke="white" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                  {post.uploadedAssetUrls.length}
                </span>
              )}
              {favoriteButton}
            </div>
            {isMilestone && post.content && (
              <div className="post-hero-scrim">
                <div className="post-hero-title">{post.content}</div>
              </div>
            )}
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
            <p className="post-content">{post.content}</p>
          )}
          {hasPhotos && (
            <div className="post-meta">
              <span className="post-time">{timeLine}</span>
              {groupChip}
            </div>
          )}

          {TypeCardBody && <TypeCardBody post={post} />}

          {post.people && post.people.length > 0 && (
            <div className="post-people" aria-label={t('feed.peopleInPost')}>
              {post.people.map((person) => (
                <PersonChip key={person.id} person={person} />
              ))}
            </div>
          )}

          {sharedWithNames && (
            <div className="post-shared-indicator" title={t('feed.sharedWith', { names: sharedWithNames })}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M18 8a3 3 0 10-2.83-4H15a3 3 0 000 6 2.97 2.97 0 001.5-.4l-6.32 3.7a3 3 0 100 3.4l6.32 3.7A2.97 2.97 0 0015 20a3 3 0 103-3.1v-.1a3 3 0 00-1.5.4L10.18 13.5a3 3 0 000-3l6.32-3.7c.44.26.95.4 1.5.4z"
                  fill="currentColor"
                />
              </svg>
              {t('feed.sharedWith', { names: sharedWithNames })}
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
