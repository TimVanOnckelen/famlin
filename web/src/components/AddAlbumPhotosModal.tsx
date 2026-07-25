import { FormEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { addAlbumPhotos, uploadFiles, patchPostInCaches } from '@famlin/api-client';
import { Icon } from '@/components/Icon';
import './NewPostModal.css';

// Contribute photos to an ALBUM post — the write half of the collaborative
// album (any group member, not just the author). Deliberately file-upload
// only: the addPhotos interaction accepts /uploads/ paths (uploadPathSchema),
// so linked-album proxy URLs can't be contributed here, mirroring mobile's
// check-in composer. Uploads first, then POSTs the resulting paths via the
// interactions endpoint.
const MAX_PHOTOS = 10;

export function AddAlbumPhotosModal({ postId, onClose }: { postId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [files, setFiles] = useState<File[]>([]);
  const [caption, setCaption] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const submitMutation = useMutation({
    mutationFn: async () => {
      const photoUrls = await uploadFiles(files.slice(0, MAX_PHOTOS));
      return addAlbumPhotos(postId, { photoUrls, caption: caption.trim() || undefined });
    },
    onSuccess: (updated) => {
      // Refresh the post (its album enrichment) everywhere it's cached, plus
      // the comments list the contribution now lives in.
      patchPostInCaches(queryClient, postId, () => updated);
      queryClient.invalidateQueries({ queryKey: ['posts'] });
      queryClient.invalidateQueries({ queryKey: ['post', postId] });
      queryClient.invalidateQueries({ queryKey: ['comments', postId] });
      onClose();
    },
  });

  function addFiles(list: FileList | null) {
    if (!list) return;
    setFiles((prev) => [...prev, ...Array.from(list)].slice(0, MAX_PHOTOS));
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (files.length > 0 && !submitMutation.isPending) submitMutation.mutate();
  }

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal>
      <form className="modal-card" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2 className="modal-title">{t('album.addPhotosTitle')}</h2>

        {files.length > 0 && (
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
                  <Icon name="x" size={14} strokeWidth={2.5} />
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
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => fileInputRef.current?.click()}
            disabled={files.length >= MAX_PHOTOS}
          >
            <Icon name="image" size={18} />
            {t('newPost.addPhotos')}
          </button>
          <span className="field-hint">{t('album.addPhotosHint', { max: MAX_PHOTOS })}</span>
        </div>

        <textarea
          className="modal-textarea"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder={t('album.captionPlaceholder')}
          rows={2}
          maxLength={2000}
        />

        {submitMutation.isError && <div className="modal-error">{t('album.addPhotosFailed')}</div>}

        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={files.length === 0 || submitMutation.isPending}>
            {submitMutation.isPending ? t('common.loading') : t('album.addPhotosSubmit')}
          </button>
        </div>
      </form>
    </div>
  );
}
