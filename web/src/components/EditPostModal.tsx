import { FormEvent, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Post, getUploadUrl } from '@famlin/api-client'
import { Icon } from '@/components/Icon'
import { ShimmerImage } from '@/components/ShimmerImage'
import { useEditPost } from '@/hooks/usePostMutations'
import { useModalFocus } from '@/hooks/useModalFocus'
import { fileFormatLabel, isBrowserDecodableImage, isVideoUrl } from '@/utils/media'
import './NewPostModal.css'

/** Mirrors uploadedAssetUrls' max in the backend's updatePostBodySchema. */
const MAX_POST_ASSETS = 20

// Edits an existing post's text and photos — the web counterpart of mobile
// PostDetailScreen's inline post editor. Reuses NewPostModal's look (same
// modal card, textarea and photo-preview strip), but deliberately not its
// family/audience/type pickers: an edit never moves a post or changes what
// it is. The photo strip IS the post's photo list after the edit: removing a
// tile drops it, new files are uploaded on save, and the whole list is sent
// as `uploadedAssetUrls` (the server replaces the stored list wholesale).
// Authors edit their own posts; admins may edit anyone's (see PostCard).
export function EditPostModal({ post, onClose }: { post: Post; onClose: () => void }) {
  const { t } = useTranslation()
  const [content, setContent] = useState(post.content ?? '')
  const [assetUrls, setAssetUrls] = useState<string[]>(post.uploadedAssetUrls)
  const [files, setFiles] = useState<File[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  // No autoFocus on the textarea: useModalFocus focuses it (the first field)
  // itself, and an autoFocus would steal focus before the hook records what
  // to restore on close — leaving focus on <body>, outside the detail modal
  // underneath, whose Esc then stops working.
  useModalFocus(formRef, onClose)

  const editMutation = useEditPost(post)

  const room = MAX_POST_ASSETS - assetUrls.length - files.length
  // A post can be photos-only or text-only, but not neither (same rule as
  // mobile's editor and the composer).
  const canSave = !editMutation.isPending && (content.trim().length > 0 || assetUrls.length > 0 || files.length > 0)

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!canSave) return
    editMutation.mutate({ content: content.trim(), uploadedAssetUrls: assetUrls, files }, { onSuccess: onClose })
  }

  function addFiles(list: FileList | null) {
    if (!list) return
    setFiles((prev) => [...prev, ...Array.from(list)].slice(0, MAX_POST_ASSETS - assetUrls.length))
  }

  // Portaled to <body>: it's opened from a PostCard that, in the detail view,
  // sits inside PostDetailModal's own dialog — this keeps it out of that
  // dialog's stacking context and Tab trap.
  return createPortal(
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal aria-label={t('editPost.title')}>
      <form className="modal-card" ref={formRef} tabIndex={-1} onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2 className="modal-title">{t('editPost.title')}</h2>

        <textarea
          className="modal-textarea"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={post.type === 'MILESTONE' ? t('newPost.milestonePlaceholder') : t('newPost.placeholder')}
          aria-label={t('editPost.contentLabel')}
          rows={post.type === 'MILESTONE' ? 2 : 5}
          maxLength={5000}
        />

        {(assetUrls.length > 0 || files.length > 0) && (
          <div className="photo-previews">
            {assetUrls.map((url) => (
              <div key={url} className="photo-preview">
                {isVideoUrl(url) ? (
                  <video src={getUploadUrl(url)} preload="metadata" />
                ) : (
                  <ShimmerImage src={getUploadUrl(url, 'thumbnail')} fallbackSrc={getUploadUrl(url)} />
                )}
                <button
                  type="button"
                  className="photo-preview-remove"
                  onClick={() => setAssetUrls((prev) => prev.filter((u) => u !== url))}
                  aria-label={t('newPost.removePhoto')}
                >
                  <Icon name="x" size={14} strokeWidth={2.5} />
                </button>
              </div>
            ))}
            {files.map((file, i) => (
              <div key={`${file.name}-${i}`} className="photo-preview">
                {file.type.startsWith('video/') ? (
                  <video src={URL.createObjectURL(file)} />
                ) : isBrowserDecodableImage(file) ? (
                  <img src={URL.createObjectURL(file)} alt={file.name} />
                ) : (
                  <span className="photo-preview-placeholder" title={file.name}>
                    <Icon name="image" size={20} />
                    <span className="photo-preview-format">{fileFormatLabel(file)}</span>
                  </span>
                )}
                <button
                  type="button"
                  className="photo-preview-remove"
                  onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
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
            disabled={room <= 0}
            onClick={() => {
              // Cleared before opening, not in onChange — see NewPostModal.
              if (fileInputRef.current) fileInputRef.current.value = ''
              fileInputRef.current?.click()
            }}
          >
            <Icon name="image" size={18} />
            {t('newPost.addPhotos')}
          </button>
        </div>

        {editMutation.isError && <div className="modal-error">{t('editPost.failed')}</div>}

        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={!canSave}>
            {editMutation.isPending ? t('common.loading') : t('editPost.save')}
          </button>
        </div>
      </form>
    </div>,
    document.body
  )
}
