import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  ImmichAsset,
  getGroupImmichAlbums,
  getImmichAlbumAssets,
  getUploadUrl,
} from '@famlin/api-client';
import './ImmichPickerModal.css';

export function ImmichPickerModal({
  groupId,
  onConfirm,
  onClose,
}: {
  groupId: string;
  onConfirm: (assets: ImmichAsset[]) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [chosenLinkId, setChosenLinkId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const albumsQuery = useQuery({
    queryKey: ['immich-albums', groupId],
    queryFn: () => getGroupImmichAlbums(groupId),
  });
  const albums = albumsQuery.data ?? [];

  // A single linked album skips the album list entirely.
  const linkId = chosenLinkId ?? (albums.length === 1 ? albums[0].linkId : null);

  const assetsQuery = useQuery({
    queryKey: ['immich-assets', linkId],
    queryFn: () => getImmichAlbumAssets(linkId!),
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
      <div className="modal-card immich-card" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-title">{t('immich.title')}</h2>

        {albumsQuery.isLoading && <div className="comments-hint">{t('common.loading')}</div>}
        {albumsQuery.isError && <div className="modal-error">{t('immich.loadFailed')}</div>}

        {linkId === null && albums.length > 1 && (
          <div className="immich-albums">
            {albums.map((album) => (
              <button
                key={album.linkId}
                className="immich-album"
                onClick={() => setChosenLinkId(album.linkId)}
              >
                <span className="immich-album-name">{album.albumName}</span>
                <span className="immich-album-count">{album.assetCount}</span>
              </button>
            ))}
          </div>
        )}

        {linkId !== null && (
          <>
            {albums.length > 1 && (
              <button
                className="immich-back"
                onClick={() => {
                  setChosenLinkId(null);
                  setSelected(new Set());
                }}
              >
                ‹ {t('immich.backToAlbums')}
              </button>
            )}
            {assetsQuery.isLoading && <div className="comments-hint">{t('common.loading')}</div>}
            {assetsQuery.isError && <div className="modal-error">{t('immich.loadFailed')}</div>}
            {assetsQuery.isSuccess && assets.length === 0 && (
              <div className="comments-hint">{t('immich.empty')}</div>
            )}
            <div className="immich-grid">
              {assets.map((asset) => {
                const isSelected = selected.has(asset.assetId);
                return (
                  <button
                    key={asset.assetId}
                    className={`immich-thumb${isSelected ? ' immich-thumb-selected' : ''}`}
                    onClick={() => toggle(asset.assetId)}
                    aria-pressed={isSelected}
                  >
                    <img src={getUploadUrl(asset.thumbnailUrl)} alt="" loading="lazy" />
                    {asset.type === 'VIDEO' && <span className="immich-video-badge">▶</span>}
                    {isSelected && <span className="immich-check">✓</span>}
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
            {t('immich.addCount', { count: selected.size })}
          </button>
        </div>
      </div>
    </div>
  );
}
