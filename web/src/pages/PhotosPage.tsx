import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  fetchAlbumPosts,
  fetchGroups,
  getGroupPhotoTimeline,
  getGroupMediaPeople,
  getUploadUrl,
  PhotoItem,
  Post,
  User,
} from '@famlin/api-client';
import { Icon } from '@/components/Icon';
import { isVideoUrl } from '@/utils/media';
import { AppHeader } from '@/components/AppHeader';
import { BottomNav } from '@/components/BottomNav';
import { Lightbox } from '@/components/Lightbox';
import { ShimmerImage } from '@/components/ShimmerImage';
import { NewPostModal } from '@/components/NewPostModal';
import './PhotosPage.css';

export function PhotosPage({
  user,
  onOpenFeed,
  onOpenChat,
  onOpenProfile,
  onOpenAlbum,
  onLogout,
}: {
  user: User;
  onOpenFeed?: () => void;
  onOpenChat?: () => void;
  onOpenProfile: () => void;
  onOpenAlbum?: (postId: string) => void;
  onLogout: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerGroupId, setComposerGroupId] = useState<string | null>(null);
  const [composerAsset, setComposerAsset] = useState<PhotoItem | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const groupsQuery = useQuery({ queryKey: ['groups'], queryFn: fetchGroups });
  const groups = groupsQuery.data ?? [];

  // Default to first group if user has groups
  const activeGroupId = selectedGroupId ?? groups[0]?.id ?? null;

  const peopleQuery = useQuery({
    queryKey: ['media-people', activeGroupId],
    queryFn: () => getGroupMediaPeople(activeGroupId!),
    enabled: activeGroupId !== null,
  });
  const people = peopleQuery.data ?? [];

  // The group's shared (collaborative ALBUM) posts, shown as a strip above the
  // timeline — without this they're only reachable by scrolling the feed until
  // the album card shows up again. One page is plenty for a strip; the feed
  // remains the place to see older ones.
  const albumsQuery = useQuery({
    queryKey: ['album-posts', activeGroupId],
    queryFn: () => fetchAlbumPosts({ groupIds: [activeGroupId!] }),
    enabled: activeGroupId !== null,
  });
  const albums = albumsQuery.data?.items ?? [];

  const photosQuery = useInfiniteQuery({
    queryKey: ['photos', activeGroupId, selectedPersonId],
    queryFn: ({ pageParam }) =>
      getGroupPhotoTimeline(activeGroupId!, {
        cursor: pageParam ?? undefined,
        personId: selectedPersonId ?? undefined,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: activeGroupId !== null,
  });

  const photos = photosQuery.data?.pages.flatMap((page) => page.items) ?? [];

  // Group photos by month+year
  const groupedByMonth = photos.reduce(
    (acc, photo) => {
      const date = new Date(photo.takenAt);
      const monthKey = date.toLocaleDateString(i18n.language, {
        year: 'numeric',
        month: 'long',
      });
      if (!acc[monthKey]) acc[monthKey] = [];
      acc[monthKey].push(photo);
      return acc;
    },
    {} as Record<string, PhotoItem[]>
  );

  const monthKeys = Object.keys(groupedByMonth);

  // Infinite scroll sentinel
  const handleObserve = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      if (entries[0]?.isIntersecting && photosQuery.hasNextPage && !photosQuery.isFetchingNextPage) {
        photosQuery.fetchNextPage();
      }
    },
    [photosQuery]
  );

  // Intersection observer for infinite scroll
  useEffect(() => {
    const observer = new IntersectionObserver(handleObserve, {
      rootMargin: '100px',
    });
    if (sentinelRef.current) {
      observer.observe(sentinelRef.current);
    }
    return () => observer.disconnect();
  }, [handleObserve]);

  const openLightbox = (photo: PhotoItem) => {
    const index = photos.indexOf(photo);
    setLightboxIndex(index);
    setLightboxOpen(true);
  };

  const handleShareToFeed = (photo: PhotoItem) => {
    // For album photos, open the composer with this photo preselected
    if (photo.source === 'album') {
      setComposerGroupId(activeGroupId);
      setComposerAsset(photo);
      setComposerOpen(true);
    }
  };

  // URLs for lightbox (all loaded photos)
  const allPhotoUrls = photos.map((p) => getUploadUrl(p.previewUrl));

  return (
    <div className="photos-shell">
      <AppHeader
        user={user}
        onNewPost={() => {
          setComposerGroupId(activeGroupId);
          setComposerAsset(null);
          setComposerOpen(true);
        }}
        onProfile={onOpenProfile}
        onApiTokens={() => {}}
        onLogout={onLogout}
      />

      <main className="photos-column">
        {groups.length > 1 && (
          <div className="photos-filter" role="group" aria-label={t('photos.filterLabel')}>
            <button
              className={`filter-chip${selectedGroupId === null ? ' filter-chip-active' : ''}`}
              onClick={() => setSelectedGroupId(null)}
            >
              {t('photos.allFamilies')}
            </button>
            {groups.map((group) => (
              <button
                key={group.id}
                className={`filter-chip${selectedGroupId === group.id ? ' filter-chip-active' : ''}`}
                onClick={() => setSelectedGroupId(group.id)}
                aria-pressed={selectedGroupId === group.id}
              >
                {group.name}
              </button>
            ))}
          </div>
        )}

        {people.length > 0 && (
          <div className="photos-person-filter" role="group" aria-label={t('photos.filterByPerson')}>
            <button
              className={`filter-chip${selectedPersonId === null ? ' filter-chip-active' : ''}`}
              onClick={() => setSelectedPersonId(null)}
            >
              {t('photos.allPeople')}
            </button>
            {people.map((person) => (
              <button
                key={person.id}
                className={`filter-chip${selectedPersonId === person.id ? ' filter-chip-active' : ''}`}
                onClick={() => setSelectedPersonId(person.id)}
                aria-pressed={selectedPersonId === person.id}
              >
                {person.label}
              </button>
            ))}
          </div>
        )}

        {albums.length > 0 && (
          <section className="photos-albums" aria-label={t('photos.albumsTitle')}>
            <h2 className="photos-section-header">{t('photos.albumsTitle')}</h2>
            <div className="photos-albums-strip">
              {albums.map((album) => (
                <AlbumTile key={album.id} post={album} onOpen={() => onOpenAlbum?.(album.id)} />
              ))}
            </div>
          </section>
        )}

        {photosQuery.isLoading && <div className="photos-hint">{t('common.loading')}</div>}

        {photosQuery.isError && (
          <div className="photos-hint">
            {t('photos.loadFailed')}{' '}
            <button className="photos-retry" onClick={() => photosQuery.refetch()}>
              {t('common.retry')}
            </button>
          </div>
        )}

        {photosQuery.isSuccess && photos.length === 0 && (
          <div className="photos-empty">
            <div className="photos-empty-icon" aria-hidden>
              <Icon name="camera" size={40} strokeWidth={1.5} />
            </div>
            <p>{t('photos.empty')}</p>
          </div>
        )}

        {photos.length > 0 && albums.length > 0 && (
          <h2 className="photos-section-header">{t('photos.allPhotosTitle')}</h2>
        )}

        {photos.length > 0 && (
          <div className="photos-timeline">
            {monthKeys.map((monthKey) => (
              <div key={monthKey} className="photos-month-section">
                <h2 className="photos-month-header">{monthKey}</h2>
                <div className="photos-grid">
                  {groupedByMonth[monthKey].map((photo) => (
                    <PhotoTile
                      key={photo.id}
                      photo={photo}
                      onOpen={() => openLightbox(photo)}
                      onShare={() => handleShareToFeed(photo)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <div ref={sentinelRef} className="photos-sentinel" />
      </main>

      <BottomNav
        active="photos"
        onFeed={onOpenFeed ?? (() => {})}
        onChat={onOpenChat}
        onProfile={onOpenProfile}
        onNewPost={() => {
          setComposerGroupId(activeGroupId);
          setComposerAsset(null);
          setComposerOpen(true);
        }}
      />

      {lightboxOpen && (
        <Lightbox
          assetUrls={allPhotoUrls}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxOpen(false)}
        />
      )}

      {composerOpen && composerGroupId && (
        <NewPostModal
          groups={groups.filter((g) => g.id === composerGroupId)}
          defaultGroupId={composerGroupId}
          onClose={() => {
            setComposerOpen(false);
            setComposerAsset(null);
          }}
          initialAsset={composerAsset}
        />
      )}
    </div>
  );
}

// One album in the Photos tab's albums strip: a 2×2 collage of the album's
// newest photos (the same `album.collagePhotoUrls` the feed card uses, so no
// extra request), its title, and its counts. Deliberately lighter than
// AlbumFeedCard — no reactions, no inline "add photos" — since this is a
// wayfinding strip, not a feed card; everything else lives one click away in
// AlbumDetailPage.
function AlbumTile({ post, onOpen }: { post: Post; onOpen: () => void }) {
  const { t } = useTranslation();
  const album = post.album;
  if (!album) return null;

  const urls = album.collagePhotoUrls.length > 0 ? album.collagePhotoUrls : album.coverPhotoUrl ? [album.coverPhotoUrl] : [];
  const visible = urls.slice(0, 4);
  const overflow = Math.max(0, album.photoCount - visible.length);

  return (
    <button type="button" className="photos-album-tile" onClick={onOpen}>
      {visible.length === 0 ? (
        <span className="photos-album-collage photos-album-collage-empty" aria-hidden>
          <Icon name="image" size={32} strokeWidth={1.5} />
        </span>
      ) : (
        <span className={`photos-album-collage photos-album-collage-${visible.length}`} aria-hidden>
          {visible.map((url, i) => (
            <span key={`${url}-${i}`} className="photos-album-collage-tile">
              {isVideoUrl(url) ? (
                <video src={getUploadUrl(url)} muted preload="metadata" />
              ) : (
                <ShimmerImage src={getUploadUrl(url, 'thumbnail')} fallbackSrc={getUploadUrl(url)} loading="lazy" />
              )}
              {i === visible.length - 1 && overflow > 0 && <span className="photos-album-collage-more">+{overflow}</span>}
            </span>
          ))}
        </span>
      )}
      <span className="photos-album-title">{album.title}</span>
      <span className="photos-album-meta">
        {album.closed && <span className="photos-album-closed">{t('feed.album.closedBadge')}</span>}
        {t('feed.album.stats', { photos: album.photoCount, contributors: album.contributorCount })}
      </span>
    </button>
  );
}

interface PhotoTileProps {
  photo: PhotoItem;
  onOpen: () => void;
  onShare: () => void;
}

function PhotoTile({ photo, onOpen, onShare }: PhotoTileProps) {
  const { t } = useTranslation();
  const [showActions, setShowActions] = useState(false);
  const src = getUploadUrl(photo.thumbnailUrl);
  const isVideo = photo.type === 'VIDEO';

  return (
    <div
      className="photo-tile"
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      <button className="photo-tile-button" onClick={onOpen} aria-label={photo.albumName || 'Open photo'}>
        <ShimmerImage src={src} className="photo-tile-image" loading="lazy" />
        {isVideo && (
          <div className="photo-tile-play-icon" aria-hidden>
            ▶
          </div>
        )}
      </button>

      {showActions && photo.source === 'album' && (
        <div className="photo-tile-actions">
          <button className="photo-tile-action" onClick={onShare} title={t('photos.shareToFeed')}>
            {t('photos.shareToFeed')}
          </button>
        </div>
      )}
    </div>
  );
}

