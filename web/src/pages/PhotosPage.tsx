import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  fetchGroups,
  getGroupPhotoTimeline,
  getGroupMediaPeople,
  getUploadUrl,
  PhotoItem,
  User,
} from '@famlin/api-client';
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
  onLogout,
}: {
  user: User;
  onOpenFeed?: () => void;
  onOpenChat?: () => void;
  onOpenProfile: () => void;
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
            <div className="photos-empty-emoji">📸</div>
            <p>{t('photos.empty')}</p>
          </div>
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

