import { FormEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  createPost,
  getGroupMediaAlbums,
  getUploadUrl,
  Group,
  MediaAsset,
  PhotoItem,
} from '@famlin/api-client';
import { MediaPickerModal } from '@/components/MediaPickerModal';
import { ShimmerImage } from '@/components/ShimmerImage';
import './NewPostModal.css';

// The post types this composer knows how to build, in chip order.
const COMPOSER_TYPES = ['UPDATE', 'MILESTONE', 'POLL'] as const;
type ComposerType = (typeof COMPOSER_TYPES)[number];

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
  initialAsset,
}: {
  groups: Group[];
  defaultGroupId: string | null;
  onClose: () => void;
  initialAsset?: PhotoItem | null;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const initialGroupId = defaultGroupId ?? groups[0]?.id ?? '';
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>(
    initialGroupId ? [initialGroupId] : []
  );
  const [type, setType] = useState<ComposerType>('UPDATE');
  const [content, setContent] = useState('');
  // Poll options: always at least 2 rows in the editor (spec: 2–10 options);
  // blank rows are filtered out on submit and don't count toward the ≥2
  // validation requirement.
  const [pollOptions, setPollOptions] = useState<string[]>(['', '']);
  const [files, setFiles] = useState<File[]>([]);
  const [mediaAssets, setMediaAssets] = useState<MediaAsset[]>(
    initialAsset && initialAsset.source === 'album'
      ? [
          {
            assetId: initialAsset.assetId || initialAsset.id,
            type: initialAsset.type,
            width: initialAsset.width,
            height: initialAsset.height,
            thumbnailUrl: initialAsset.thumbnailUrl,
            previewUrl: initialAsset.previewUrl,
            originalUrl: initialAsset.originalUrl,
          },
        ]
      : []
  );
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // The linked-album picker targets a single group; when cross-posting to
  // several, drive it off the first one picked — the server copies
  // linked-album photos so every group ends up able to see them.
  const primaryGroupId = selectedGroupIds[0] ?? '';

  // "Choose from albums" only appears when the primary group actually has
  // linked albums (from any media source) — same behavior as the mobile
  // composer.
  const mediaAlbumsQuery = useQuery({
    queryKey: ['media-albums', primaryGroupId],
    queryFn: () => getGroupMediaAlbums(primaryGroupId),
    enabled: !!primaryGroupId,
  });
  const hasLinkedAlbums = (mediaAlbumsQuery.data?.length ?? 0) > 0;

  // Admins can restrict which post types a group allows. The server sends the
  // resolved effective list as Group.allowedPostTypes; a missing field (older
  // server or cached data from before the feature) means "all allowed". With
  // several target groups selected, only the INTERSECTION of their lists is
  // offered — every target group must accept the type, since cross-posting
  // creates one post per group.
  const offeredTypes = COMPOSER_TYPES.filter((candidate) =>
    selectedGroupIds.every((id) => {
      const allowed = groups.find((g) => g.id === id)?.allowedPostTypes;
      return !allowed || allowed.includes(candidate);
    })
  );

  // When the group selection changes and the current type is no longer
  // offered, fall back to the first type that still is (if any is left).
  useEffect(() => {
    if (!offeredTypes.includes(type) && offeredTypes.length > 0) {
      setType(offeredTypes[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offeredTypes.join(','), type]);

  // Blank rows in the editor don't count as real options.
  const nonEmptyPollOptions = pollOptions.map((o) => o.trim()).filter((o) => o.length > 0);

  const submitMutation = useMutation({
    mutationFn: async () => {
      const uploadedUrls = files.length > 0 ? await uploadFiles(files) : [];
      // previewUrl is a JPEG still even for a video, so videos attach their
      // original rendition instead (mirrors mobile's MediaPickerModal).
      const mediaUrls = mediaAssets.map((a) => (a.type === 'VIDEO' ? a.originalUrl : a.previewUrl));
      return createPost({
        groupId: primaryGroupId,
        // Omit groupIds entirely for a single group so older servers that
        // don't know about cross-posting behave identically.
        groupIds: selectedGroupIds.length > 1 ? selectedGroupIds : undefined,
        content: content.trim() || undefined,
        type,
        // Poll options only — no closesAt UI in v1 (API-only, backend default).
        typeData: type === 'POLL' ? { options: nonEmptyPollOptions.map((text) => ({ text })) } : undefined,
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

  function toggleGroup(id: string) {
    setSelectedGroupIds((prev) => (prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id]));
  }

  function addFiles(list: FileList | null) {
    if (!list) return;
    setFiles((prev) => [...prev, ...Array.from(list)]);
    // Allow re-picking the same file after removing it.
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function updatePollOption(index: number, value: string) {
    setPollOptions((prev) => prev.map((o, i) => (i === index ? value : o)));
  }

  function addPollOption() {
    setPollOptions((prev) => (prev.length < 10 ? [...prev, ''] : prev));
  }

  function removePollOption(index: number) {
    setPollOptions((prev) => (prev.length > 2 ? prev.filter((_, i) => i !== index) : prev));
  }

  const canSubmit =
    selectedGroupIds.length > 0 &&
    // The chosen type must be allowed by every selected group; an empty
    // intersection therefore blocks submitting entirely.
    offeredTypes.includes(type) &&
    !submitMutation.isPending &&
    (type === 'POLL'
      ? content.trim().length > 0 && nonEmptyPollOptions.length >= 2
      : content.trim().length > 0 || files.length > 0 || mediaAssets.length > 0);

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal>
      <form className="modal-card" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2 className="modal-title">{t('newPost.title')}</h2>

        {groups.length > 1 && (
          <div className="field">
            <span className="field-label">{t('newPost.group')}</span>
            <span className="field-hint">{t('newPost.groupHint')}</span>
            <div className="group-select-chips" role="group" aria-label={t('newPost.group')}>
              {groups.map((group) => (
                <button
                  key={group.id}
                  type="button"
                  className={`filter-chip${selectedGroupIds.includes(group.id) ? ' filter-chip-active' : ''}`}
                  onClick={() => toggleGroup(group.id)}
                  aria-pressed={selectedGroupIds.includes(group.id)}
                >
                  {group.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {offeredTypes.length > 0 ? (
          <div className="type-chips" role="radiogroup" aria-label={t('newPost.typeLabel')}>
            {offeredTypes.includes('UPDATE') && (
              <button
                type="button"
                className={`type-chip${type === 'UPDATE' ? ' type-chip-active' : ''}`}
                onClick={() => setType('UPDATE')}
              >
                {t('newPost.typeUpdate')}
              </button>
            )}
            {offeredTypes.includes('MILESTONE') && (
              <button
                type="button"
                className={`type-chip type-chip-milestone${type === 'MILESTONE' ? ' type-chip-milestone-active' : ''}`}
                onClick={() => setType('MILESTONE')}
              >
                {t('newPost.typeMilestone')}
              </button>
            )}
            {offeredTypes.includes('POLL') && (
              <button
                type="button"
                className={`type-chip type-chip-poll${type === 'POLL' ? ' type-chip-poll-active' : ''}`}
                onClick={() => setType('POLL')}
              >
                {t('newPost.typePoll')}
              </button>
            )}
          </div>
        ) : (
          <div className="modal-error">{t('newPost.noAllowedTypes')}</div>
        )}

        <textarea
          className="modal-textarea"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={
            type === 'MILESTONE'
              ? t('newPost.milestonePlaceholder')
              : type === 'POLL'
                ? t('newPost.pollPlaceholder')
                : t('newPost.placeholder')
          }
          rows={type === 'UPDATE' ? 5 : 2}
          maxLength={5000}
          autoFocus
        />

        {type === 'POLL' && offeredTypes.includes('POLL') && (
          <div className="poll-options-editor" role="group" aria-label={t('newPost.typePoll')}>
            {pollOptions.map((option, i) => (
              <div key={i} className="poll-option-input-row">
                <input
                  className="field-input poll-option-input"
                  type="text"
                  value={option}
                  onChange={(e) => updatePollOption(i, e.target.value)}
                  placeholder={t('newPost.pollOptionPlaceholder', { number: i + 1 })}
                  maxLength={100}
                />
                {pollOptions.length > 2 && (
                  <button
                    type="button"
                    className="poll-option-remove"
                    onClick={() => removePollOption(i)}
                    aria-label={t('newPost.removeOption')}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            {pollOptions.length < 10 && (
              <button type="button" className="btn btn-secondary poll-add-option" onClick={addPollOption}>
                {t('newPost.addOption')}
              </button>
            )}
          </div>
        )}

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
                <ShimmerImage src={getUploadUrl(asset.thumbnailUrl)} />
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
          groupId={primaryGroupId}
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
