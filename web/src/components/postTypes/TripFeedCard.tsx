import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Post,
  ReactionType,
  REACTION_TYPES,
  reactToPost,
  patchPostInCaches,
  getUploadUrl,
} from '@famlin/api-client';
import { REACTION_EMOJI } from '@/constants/reactions';
import { Avatar } from '@/components/Avatar';
import { ShimmerImage } from '@/components/ShimmerImage';
import { formatTime } from '@/utils/time';
import { formatTripDateRange } from '@/utils/trip';
import { isVideoUrl } from '@/utils/media';
import '../PostCard.css';
import './TripFeedCard.css';

// The feed card for a TRIP post (design t6, screens 6a/6b) — different
// enough from the generic UPDATE/MILESTONE card (its own hero source, no
// inline comments, a "follow/view diary" CTA instead of a comment button)
// that PostCard delegates to it wholesale for post.type === 'TRIP', rather
// than through the postTypeRenderers registry (that registry only appends a
// body under the normal photo/content rendering — see
// components/postTypes/index.ts — TRIP replaces it entirely). Mirrors
// mobile's TripCard.tsx.
export function TripFeedCard({
  post,
  showGroup = false,
  onOpenTrip,
}: {
  post: Post;
  showGroup?: boolean;
  onOpenTrip?: (postId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const trip = post.trip;

  // Same reaction mutation as PostCard's — kept local rather than shared via
  // a hook since PostCard doesn't expose one, matching the rest of this
  // codebase's style of inlining query mutations per component.
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

  // Guard mirrors the mobile component: post.type === 'TRIP' without
  // post.trip shouldn't happen (the server always enriches it), but an
  // older/partial cache entry is possible.
  if (!trip) return null;

  const groupChip = showGroup && post.group && <span className="post-group-chip">{post.group.name}</span>;
  const openLabel = trip.closed ? t('feed.trip.viewDiaryCta') : t('feed.trip.followCta');

  const reactionRow = (
    <div className="trip-card-actions">
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
      <button type="button" className="trip-card-cta" onClick={() => onOpenTrip?.(post.id)}>
        {openLabel}
      </button>
    </div>
  );

  if (trip.closed) {
    return (
      <article className="post-card">
        <div className="post-card-inner trip-card-inner">
          <TripClosedCollage
            collagePhotoUrls={trip.collagePhotoUrls}
            photoCount={trip.photoCount}
            label={`${trip.title} — ${openLabel}`}
            onOpen={() => onOpenTrip?.(post.id)}
          />
          <div className="post-body trip-card-body">
            <div className="trip-card-badge-row">
              <span className="trip-badge trip-badge-closed">{t('feed.trip.closedBadge')}</span>
              {groupChip}
            </div>
            <h3 className="trip-card-title">{trip.title}</h3>
            {trip.durationDays != null && (
              <div className="trip-card-muted">
                {t('feed.trip.closedStats', {
                  days: trip.durationDays,
                  stops: trip.stopCount,
                  photos: trip.photoCount,
                })}
              </div>
            )}
            {trip.endDate && (
              <div className="trip-card-muted">
                {t('feed.trip.authorDateRange', {
                  author: post.author.name,
                  range: formatTripDateRange(t, i18n.language, trip.startDate, trip.endDate),
                })}
              </div>
            )}
            {reactionRow}
          </div>
        </div>
      </article>
    );
  }

  const heroUrl = trip.collagePhotoUrls[0] || trip.coverPhotoUrl;

  return (
    <article className="post-card">
      <div className="post-card-inner trip-card-inner">
        <button
          type="button"
          className="trip-card-hero"
          onClick={() => onOpenTrip?.(post.id)}
          aria-label={`${trip.title} — ${openLabel}`}
        >
          {heroUrl ? (
            isVideoUrl(heroUrl) ? (
              <video src={getUploadUrl(heroUrl)} className="trip-card-hero-media" muted preload="metadata" />
            ) : (
              <ShimmerImage
                src={getUploadUrl(heroUrl, 'thumbnail')}
                fallbackSrc={getUploadUrl(heroUrl)}
                className="trip-card-hero-media"
                loading="lazy"
              />
            )
          ) : (
            <div className="trip-card-hero-placeholder" aria-hidden>
              🧳
            </div>
          )}
          {trip.dayNumber != null && (
            <span className="trip-badge trip-badge-active trip-card-hero-badge">
              {t('feed.trip.activeBadge', { day: trip.dayNumber })}
            </span>
          )}
          <span className="trip-card-hero-author">
            <Avatar name={post.author.name} avatarUrl={post.author.avatarUrl} size={32} />
          </span>
        </button>
        <div className="post-body trip-card-body">
          <div className="trip-card-badge-row">
            <button type="button" className="trip-card-title trip-card-title-btn" onClick={() => onOpenTrip?.(post.id)}>
              {trip.title}
            </button>
            {groupChip}
          </div>
          {trip.destination && <div className="trip-card-destination">→ {trip.destination}</div>}
          {trip.latestCheckin && (
            <div className="trip-card-last-stop">
              📍 {t('feed.trip.lastStopLabel')}{' '}
              <strong>{trip.latestCheckin.place}</strong> · {formatTime(trip.latestCheckin.createdAt, i18n.language)}
            </div>
          )}
          <div className="trip-card-muted">
            {t('feed.trip.stopsSoFar', { count: trip.stopCount, author: post.author.name })}
          </div>
          {reactionRow}
        </div>
      </div>
    </article>
  );
}

// Closed-trip collage (design 6b, adapted for web's wider card): a fixed 2×2
// grid built from up to 3 "newest" photos (trip.collagePhotoUrls) plus a 4th
// tile — an overflow "+N" count when the trip has more photos than fit,
// otherwise the last available photo repeated so the grid never shows a
// blank cell (purely decorative; photoCount/collagePhotoUrls stay the source
// of truth for the real counts shown in the stats line below).
function TripClosedCollage({
  collagePhotoUrls,
  photoCount,
  label,
  onOpen,
}: {
  collagePhotoUrls: string[];
  photoCount: number;
  label: string;
  onOpen: () => void;
}) {
  if (collagePhotoUrls.length === 0) {
    return (
      <button type="button" className="trip-card-collage" onClick={onOpen} aria-label={label}>
        <div className="trip-card-hero-placeholder" aria-hidden>
          🧳
        </div>
      </button>
    );
  }

  const overflow = Math.max(0, photoCount - collagePhotoUrls.length);
  const cells = [0, 1, 2, 3].map((i) => collagePhotoUrls[i] ?? collagePhotoUrls[collagePhotoUrls.length - 1]);

  return (
    <button type="button" className="trip-card-collage" onClick={onOpen} aria-label={label}>
      {cells.map((url, i) => (
        <span key={i} className="trip-card-collage-tile">
          {isVideoUrl(url) ? (
            <video src={getUploadUrl(url)} muted preload="metadata" />
          ) : (
            <ShimmerImage src={getUploadUrl(url, 'thumbnail')} fallbackSrc={getUploadUrl(url)} loading="lazy" />
          )}
          {i === 3 && overflow > 0 && <span className="trip-card-collage-more">+{overflow}</span>}
        </span>
      ))}
    </button>
  );
}
