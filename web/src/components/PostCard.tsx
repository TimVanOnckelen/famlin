import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Post, PostPerson, REACTION_TYPES, getUploadUrl } from '@famlin/api-client';
import { REACTION_EMOJI } from '@/constants/reactions';
import { Avatar } from '@/components/Avatar';
import { Icon } from '@/components/Icon';
import { CircleBadge } from '@/components/CircleBadge';
import { CommentsSection } from '@/components/CommentsSection';
import { Lightbox } from '@/components/Lightbox';
import { ShimmerImage } from '@/components/ShimmerImage';
import { postTypeRenderers } from '@/components/postTypes';
import { TripFeedCard } from '@/components/postTypes/TripFeedCard';
import { AlbumFeedCard } from '@/components/postTypes/AlbumFeedCard';
import { useReactToPost, useToggleFavorite } from '@/hooks/usePostMutations';
import { formatRelativeDate } from '@/utils/time';
import { isVideoUrl } from '@/utils/media';
import { paths } from '@/utils/routes';
import './PostCard.css';

// Past this many photos the collage becomes a horizontally scrolling gallery
// instead — every photo stays reachable on the card itself rather than hiding
// behind a "+N" tile. Matches the comment cards' threshold.
const COLLAGE_MAX_PHOTOS = 4;

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

  if (assetUrls.length > COLLAGE_MAX_PHOTOS) {
    return (
      <div className="post-collage post-collage-gallery">
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
  const AVATAR_COLORS = ['var(--fam-primary)', 'var(--fam-accent)', '#4b8b5a', 'var(--fam-primary-dark)'];
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
  onOpenAlbum,
  showComments = false,
}: {
  post: Post;
  showGroup?: boolean;
  onOpenTrip?: (postId: string) => void;
  onOpenAlbum?: (postId: string) => void;
  // The single-post page/modal shows the full thread unconditionally; the
  // feed shows only the comment-count line (clicking it opens that page) —
  // there is no inline expand/collapse any more (issue: web redesign phase 2).
  showComments?: boolean;
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

  // ALBUM posts likewise get their own card (collage hero, contributor stack,
  // an "Add photos"/"Open album" CTA) — its photo contributions live as
  // metadata comments and must never surface in a generic inline comment list.
  if (post.type === 'ALBUM') {
    return <AlbumFeedCard post={post} showGroup={showGroup} onOpenAlbum={onOpenAlbum} />;
  }

  return <DefaultPostCard post={post} showGroup={showGroup} showComments={showComments} />;
}

function DefaultPostCard({
  post,
  showGroup = false,
  showComments = false,
}: {
  post: Post;
  showGroup?: boolean;
  showComments?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const isMilestone = post.type === 'MILESTONE';
  const hasPhotos = post.uploadedAssetUrls.length > 0;
  // Unknown/absent types fall back to the plain rendering below (required
  // forward-compat behavior); milestone stays its own hardcoded branch and is
  // never looked up here.
  const TypeCardBody = postTypeRenderers[post.type]?.CardBody;
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const reactMutation = useReactToPost(post);
  const favoriteMutation = useToggleFavorite(post);

  const timeLine = `${formatRelativeDate(post.createdAt, i18n.language)}${
    post.editedAt ? ` · ${t('common.edited')}` : ''
  }`;
  // The timestamp is the post's permalink (/posts/:id) — the link people copy
  // to share a post, the same convention as most social feeds.
  const timeLink = (
    <Link className="post-time" to={paths.post(post.id)} title={new Date(post.createdAt).toLocaleString(i18n.language)}>
      {timeLine}
    </Link>
  );
  // When the feed spans several families, label each post with its group.
  // Both context chips travel together: which family the post is in (when the
  // feed spans several) and which Circle it was shared with (when it wasn't
  // shared with everyone).
  const groupChip = (
    <>
      {showGroup && post.group && <span className="post-group-chip">{post.group.name}</span>}
      <CircleBadge post={post} />
    </>
  );

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
      <Icon name="bookmark" size={18} filled={post.favoritedByMe} />
    </button>
  );

  return (
    // A plain div, not <article>: when rendered from the feed, FeedPage wraps
    // every card (default/trip/album alike) in its own focusable element with
    // role="article" — a second, nested landmark here would be redundant (and
    // ambiguous for role-based test/assistive-tech queries).
    <div className="post-card">
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
              <span className="milestone-badge milestone-badge-overlay">
                <Icon name="gift" size={13} strokeWidth={2.2} />
                {t('feed.milestoneBadge')}
              </span>
            )}
            <div className="post-hero-top-right">
              {isCollage && (
                <span className="post-photo-count-badge">
                  <Icon name="image" size={14} color="white" />
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
              {isMilestone && (
                <span className="milestone-badge">
                  <Icon name="gift" size={13} strokeWidth={2.2} />
                  {t('feed.milestoneBadge')}
                </span>
              )}
              <div className="post-author-row">
                <Avatar name={post.author.name} avatarUrl={post.author.avatarUrl} size={44} />
                <div>
                  <div className="post-author-name">{post.author.name}</div>
                  <div className="post-meta">
                    {timeLink}
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
              {timeLink}
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
              <Icon name="share-2" size={14} />
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
                  <Icon name="heart" size={18} />
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

            {/* No onClick of its own: in the feed, FeedPage's card wrapper
                opens the post detail on a click anywhere that isn't another
                interactive child (reactions/photos/links) — this button is
                one of the things deliberately included in that, via its
                `post-comments-btn` class (see FeedPage.tsx). On the detail
                page/modal (showComments true, no such wrapper) it's just the
                count, already shown below. */}
            <button className="action-btn post-comments-btn">
              <Icon name="message-square" size={18} />
              {t('feed.comments', { count: post.commentCount })}
            </button>
          </div>

          {showComments && <CommentsSection post={post} />}
        </div>
      </div>

      {lightboxIndex !== null && (
        <Lightbox
          assetUrls={post.uploadedAssetUrls}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </div>
  );
}
