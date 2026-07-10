import { FormEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  createPost,
  getGroupMediaAlbums,
  getUploadUrl,
  Group,
  MediaAsset,
} from '@famlin/api-client';
import { MediaPickerModal } from '@/components/MediaPickerModal';
import './NewPostModal.css';

async function uploadFiles(files: File[]): Promise<string[]> {
  const formData = new FormData();
  for (const file of files) {
    formData.append('file', file);
  }
  const response = await api.post<{ urls: string[] }>('/uploads', formData);
  return response.data.urls;
}

export function NewPostModal({
  groups,
  defaultGroupId,
  onClose,
}: {
  groups: Group[];
  defaultGroupId: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [groupId, setGroupId] = useState(defaultGroupId ?? groups[0]?.id ?? '');
  const [type, setType] = useState<'UPDATE' | 'MILESTONE'>('UPDATE');
  const [content, setContent] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [mediaAssets, setMediaAssets] = useState<MediaAsset[]>([]);
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // "Choose from albums" only appears when the selected group actually has
  // linked albums (from any media source) — same behavior as the mobile
  // composer.
  const mediaAlbumsQuery = useQuery({
    queryKey: ['media-albums', groupId],
    queryFn: () => getGroupMediaAlbums(groupId),
    enabled: !!groupId,
  });
  const hasLinkedAlbums = (mediaAlbumsQuery.data?.length ?? 0) > 0;

  const submitMutation = useMutation({
    mutationFn: async () => {
      const uploadedUrls = files.length > 0 ? await uploadFiles(files) : [];
      // previewUrl is a JPEG still even for a video, so videos attach their
      // original rendition instead (mirrors mobile's MediaPickerModal).
      const mediaUrls = mediaAssets.map((a) => (a.type === 'VIDEO' ? a.originalUrl : a.previewUrl));
      return createPost({
        groupId,
        content: content.trim() || undefined,
        type,
        uploadedAssetUrls: [...uploadedUrls, ...mediaUrls],
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['posts'] });
      onClose();
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (canSubmit) submitMutation.mutate();
  }

  function addFiles(list: FileList | null) {
    if (!list) return;
    setFiles((prev) => [...prev, ...Array.from(list)]);
    // Allow re-picking the same file after removing it.
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  const canSubmit =
    !!groupId &&
    (content.trim().length > 0 || files.length > 0 || mediaAssets.length > 0) &&
    !submitMutation.isPending;

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal>
      <form className="modal-card" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2 className="modal-title">{t('newPost.title')}</h2>

        {groups.length > 1 && (
          <label className="field">
            <span className="field-label">{t('newPost.group')}</span>
            <select className="field-input" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="type-chips" role="radiogroup" aria-label={t('newPost.typeLabel')}>
          <button
            type="button"
            className={`type-chip${type === 'UPDATE' ? ' type-chip-active' : ''}`}
            onClick={() => setType('UPDATE')}
          >
            {t('newPost.typeUpdate')}
          </button>
          <button
            type="button"
            className={`type-chip type-chip-milestone${type === 'MILESTONE' ? ' type-chip-milestone-active' : ''}`}
            onClick={() => setType('MILESTONE')}
          >
            {t('newPost.typeMilestone')}
          </button>
        </div>

        <textarea
          className="modal-textarea"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={type === 'MILESTONE' ? t('newPost.milestonePlaceholder') : t('newPost.placeholder')}
          rows={type === 'MILESTONE' ? 2 : 5}
          maxLength={5000}
          autoFocus
        />

        {(files.length > 0 || mediaAssets.length > 0) && (
          <div className="photo-previews">
            {files.map((file, i) => (
              <div key={`${file.name}-${i}`} className="photo-preview">
                {file.type.startsWith('video/') ? (
                  <video src={URL.createObjectURL(file)} />
                ) : (
                  <img src={URL.createObjectURL(file)} alt={file.name} />
                )}
                <button
                  type="button"
                  className="photo-preview-remove"
                  onClick={() => setFiles(files.filter((_, j) => j !== i))}
                  aria-label={t('newPost.removePhoto')}
                >
                  ×
                </button>
              </div>
            ))}
            {mediaAssets.map((asset) => (
              <div key={asset.assetId} className="photo-preview">
                <img src={getUploadUrl(asset.thumbnailUrl)} alt="" />
                <button
                  type="button"
                  className="photo-preview-remove"
                  onClick={() => setMediaAssets(mediaAssets.filter((a) => a.assetId !== asset.assetId))}
                  aria-label={t('newPost.removePhoto')}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/mp4,video/quicktime,video/webm"
          multiple
          hidden
          onChange={(e) => addFiles(e.target.files)}
        />
        <div className="attach-actions">
          <button type="button" className="btn btn-secondary" onClick={() => fileInputRef.current?.click()}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="2" />
              <circle cx="9" cy="9" r="2" stroke="currentColor" strokeWidth="2" />
              <path d="M21 15l-5-5L5 21" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
            </svg>
            {t('newPost.addPhotos')}
          </button>
          {hasLinkedAlbums && (
            <button type="button" className="btn btn-secondary" onClick={() => setMediaPickerOpen(true)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M12 3a9 9 0 109 9 9 9 0 00-9-9zm0 5a4 4 0 11-4 4 4 4 0 014-4z"
                  stroke="currentColor"
                  strokeWidth="2"
                />
              </svg>
              {t('newPost.addFromAlbums')}
            </button>
          )}
        </div>

        {submitMutation.isError && <div className="modal-error">{t('newPost.failed')}</div>}

        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
            {submitMutation.isPending ? t('common.loading') : t('newPost.submit')}
          </button>
        </div>
      </form>

      {mediaPickerOpen && (
        <MediaPickerModal
          groupId={groupId}
          onConfirm={(assets) => {
            // Merge without duplicating an asset that was already picked.
            setMediaAssets((prev) => [
              ...prev,
              ...assets.filter((a) => !prev.some((p) => p.assetId === a.assetId)),
            ]);
            setMediaPickerOpen(false);
          }}
          onClose={() => setMediaPickerOpen(false)}
        />
      )}
    </div>
  );
}
