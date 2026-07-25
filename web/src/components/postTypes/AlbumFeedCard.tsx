import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Post, ReactionType, REACTION_TYPES, reactToPost, patchPostInCaches, getUploadUrl } from '@famlin/api-client';
import { REACTION_EMOJI } from '@/constants/reactions';
import { Avatar } from '@/components/Avatar';
import { ShimmerImage } from '@/components/ShimmerImage';
import { AddAlbumPhotosModal } from '@/components/AddAlbumPhotosModal';
import { isVideoUrl } from '@/utils/media';
import '../PostCard.css';
import './AlbumFeedCard.css';

// The feed card for an ALBUM post — a collaborative photo album any group
// member adds photos to. Like TripFeedCard, it replaces the generic card
// wholesale (its own collage hero, contributor stack, and an "Add photos" CTA
// alongside "Open album") rather than appending a body through the
// postTypeRenderers registry. Mirrors mobile's AlbumCard.tsx.
export function AlbumFeedCard({
  post,
  showGroup = false,
  onOpenAlbum,
}: {
  post: Post;
  showGroup?: boolean;
  onOpenAlbum?: (postId: string) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const album = post.album;
  const [contributeOpen, setContributeOpen] = useState(false);

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

  // Guard mirrors TripFeedCard: an ALBUM post is always enriched with `album`
  // by the server, but an older/partial cache entry is possible.
  if (!album) return null;

  const groupChip = showGroup && post.group && <span className="post-group-chip">{post.group.name}</span>;
  const heroUrls = album.collagePhotoUrls.length > 0 ? album.collagePhotoUrls : album.coverPhotoUrl ? [album.coverPhotoUrl] : [];

  return (
    <article className="post-card">
      <div className="post-card-inner album-card-inner">
        <AlbumCollage
          urls={heroUrls}
          photoCount={album.photoCount}
          label={`${album.title} — ${t('feed.album.openCta')}`}
          onOpen={() => onOpenAlbum?.(post.id)}
        />
        <div className="post-body album-card-body">
          <div className="album-card-badge-row">
            <span className="album-badge">{album.closed ? t('feed.album.closedBadge') : t('feed.album.badge')}</span>
            {groupChip}
          </div>
          <button type="button" className="album-card-title album-card-title-btn" onClick={() => onOpenAlbum?.(post.id)}>
            {album.title}
          </button>
          <div className="album-card-muted">
            {t('feed.album.stats', { photos: album.photoCount, contributors: album.contributorCount })}
          </div>

          {album.contributors.length > 0 && (
            <div className="album-card-contributors" aria-label={t('feed.album.contributorsLabel')}>
              <div className="album-card-contributors-stack">
                {album.contributors.slice(0, 5).map((contributor) => (
                  <span key={contributor.id} className="album-card-contributor-face">
                    <Avatar name={contributor.name} avatarUrl={contributor.avatarUrl} size={26} />
                  </span>
                ))}
              </div>
              <span className="album-card-contributors-text">
                {t('feed.album.contributedBy', {
                  name: album.contributors[0].name,
                  count: album.contributorCount,
                  others: album.contributorCount - 1,
                })}
              </span>
            </div>
          )}

          <div className="album-card-actions">
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
            {!album.closed && (
              <button type="button" className="album-card-add" onClick={() => setContributeOpen(true)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                {t('feed.album.addPhotosCta')}
              </button>
            )}
            <button type="button" className="album-card-cta" onClick={() => onOpenAlbum?.(post.id)}>
              {t('feed.album.openCta')}
            </button>
          </div>
        </div>
      </div>

      {contributeOpen && <AddAlbumPhotosModal postId={post.id} onClose={() => setContributeOpen(false)} />}
    </article>
  );
}

// A 2×2 collage built from up to 4 of the album's newest photos, with a "+N"
// overflow badge on the last tile. Falls back to a photo-frame placeholder
// when the album has no photos yet.
function AlbumCollage({
  urls,
  photoCount,
  label,
  onOpen,
}: {
  urls: string[];
  photoCount: number;
  label: string;
  onOpen: () => void;
}) {
  if (urls.length === 0) {
    return (
      <button type="button" className="album-card-collage album-card-collage-empty" onClick={onOpen} aria-label={label}>
        <div className="album-card-hero-placeholder" aria-hidden>
          🖼️
        </div>
      </button>
    );
  }

  const visible = urls.slice(0, 4);
  const overflow = Math.max(0, photoCount - visible.length);

  return (
    <button
      type="button"
      className={`album-card-collage album-card-collage-${visible.length}`}
      onClick={onOpen}
      aria-label={label}
    >
      {visible.map((url, i) => (
        <span key={`${url}-${i}`} className="album-card-collage-tile">
          {isVideoUrl(url) ? (
            <video src={getUploadUrl(url)} muted preload="metadata" />
          ) : (
            <ShimmerImage src={getUploadUrl(url, 'thumbnail')} fallbackSrc={getUploadUrl(url)} loading="lazy" />
          )}
          {i === visible.length - 1 && overflow > 0 && <span className="album-card-collage-more">+{overflow}</span>}
        </span>
      ))}
    </button>
  );
}
