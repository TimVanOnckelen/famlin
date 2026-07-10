import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  MediaAsset,
  getGroupMediaAlbums,
  getMediaAlbumAssets,
  getUploadUrl,
} from '@famlin/api-client';
import './MediaPickerModal.css';

// Picks photos/videos from the group's linked albums, whatever media source
// they live on (Immich, a local folder on the server, ...) — the
// provider-generic /api/media endpoints serve them all through one proxy.
export function MediaPickerModal({
  groupId,
  onConfirm,
  onClose,
}: {
  groupId: string;
  onConfirm: (assets: MediaAsset[]) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [chosenLinkId, setChosenLinkId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const albumsQuery = useQuery({
    queryKey: ['media-albums', groupId],
    queryFn: () => getGroupMediaAlbums(groupId),
  });
  const albums = albumsQuery.data ?? [];

  // A single linked album skips the album list entirely.
  const linkId = chosenLinkId ?? (albums.length === 1 ? albums[0].linkId : null);
  // The source badge only disambiguates when the group actually mixes sources.
  const multipleProviders = new Set(albums.map((a) => a.provider)).size > 1;

  const assetsQuery = useQuery({
    queryKey: ['media-assets', linkId],
    queryFn: () => getMediaAlbumAssets(linkId!),
    enabled: linkId !== null,
  });
  const assets = assetsQuery.data ?? [];

  function toggle(assetId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });
  }

  function confirm() {
    onConfirm(assets.filter((a) => selected.has(a.assetId)));
  }

  return (
    // Rendered inside the composer's overlay — stop propagation so closing
    // the picker doesn't also close the composer underneath it.
    <div
      className="modal-overlay"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
      role="dialog"
      aria-modal
    >
      <div className="modal-card media-picker-card" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-title">{t('mediaPicker.title')}</h2>

        {albumsQuery.isLoading && <div className="comments-hint">{t('common.loading')}</div>}
        {albumsQuery.isError && <div className="modal-error">{t('mediaPicker.loadFailed')}</div>}

        {linkId === null && albums.length > 1 && (
          <div className="media-picker-albums">
            {albums.map((album) => (
              <button
                key={album.linkId}
                className="media-picker-album"
                onClick={() => setChosenLinkId(album.linkId)}
              >
                <span className="media-picker-album-name">{album.albumName}</span>
                {multipleProviders && (
                  <span className="media-picker-album-provider">
                    {t(`mediaPicker.providers.${album.provider}`, album.provider)}
                  </span>
                )}
                <span className="media-picker-album-count">{album.assetCount}</span>
              </button>
            ))}
          </div>
        )}

        {linkId !== null && (
          <>
            {albums.length > 1 && (
              <button
                className="media-picker-back"
                onClick={() => {
                  setChosenLinkId(null);
                  setSelected(new Set());
                }}
              >
                ‹ {t('mediaPicker.backToAlbums')}
              </button>
            )}
            {assetsQuery.isLoading && <div className="comments-hint">{t('common.loading')}</div>}
            {assetsQuery.isError && <div className="modal-error">{t('mediaPicker.loadFailed')}</div>}
            {assetsQuery.isSuccess && assets.length === 0 && (
              <div className="comments-hint">{t('mediaPicker.empty')}</div>
            )}
            <div className="media-picker-grid">
              {assets.map((asset) => {
                const isSelected = selected.has(asset.assetId);
                return (
                  <button
                    key={asset.assetId}
                    className={`media-picker-thumb${isSelected ? ' media-picker-thumb-selected' : ''}`}
                    onClick={() => toggle(asset.assetId)}
                    aria-pressed={isSelected}
                  >
                    <img src={getUploadUrl(asset.thumbnailUrl)} alt="" loading="lazy" />
                    {asset.type === 'VIDEO' && <span className="media-picker-video-badge">▶</span>}
                    {isSelected && <span className="media-picker-check">✓</span>}
                  </button>
                );
              })}
            </div>
          </>
        )}

        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={confirm}
            disabled={selected.size === 0}
          >
            {t('mediaPicker.addCount', { count: selected.size })}
          </button>
        </div>
      </div>
    </div>
  );
}
