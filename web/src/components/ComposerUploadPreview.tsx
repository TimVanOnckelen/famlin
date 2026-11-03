import { useTranslation } from 'react-i18next'
import { getUploadUrl } from '@famlin/api-client'
import { fileFormatLabel, isBrowserDecodableImage } from '@/utils/media'
import { ShimmerImage } from './ShimmerImage'
import { Icon } from './Icon'
import { LivePhotoIcon } from './LivePhotoIcon'
import './NewPostModal.css'
import './ComposerUploadPreview.css'

// The same static attachment tile in every composer. Playback belongs to
// published content, not to the upload picker.
export function ComposerUploadPreview({
  item,
  livePhoto = false,
  pending = false,
}: {
  item: { file: Pick<File, 'name' | 'type'>; previewUrl: string; url?: string }
  livePhoto?: boolean
  pending?: boolean
}) {
  const { t } = useTranslation()
  const { file, previewUrl, url } = item
  return (
    <div className="composer-upload-preview">
      {url ? (
        <ShimmerImage
          src={getUploadUrl(url, 'thumbnail')}
          fallbackSrc={file.type.startsWith('video/') ? undefined : getUploadUrl(url)}
          alt={file.name}
        />
      ) : file.type.startsWith('video/') ? (
        <video src={previewUrl} />
      ) : isBrowserDecodableImage(file) ? (
        <img src={previewUrl} alt={file.name} />
      ) : (
        <span className="photo-preview-placeholder" title={file.name}>
          <Icon name="image" size={20} />
          <span className="photo-preview-format">{fileFormatLabel(file)}</span>
        </span>
      )}
      {livePhoto ? (
        <span className="photo-preview-kind" aria-label={t('media.livePhoto')}>
          <LivePhotoIcon size={17} />
        </span>
      ) : file.type.startsWith('video/') || /\.(mov|mp4|m4v|webm)$/i.test(file.name) ? (
        <span className="photo-preview-kind" aria-label={t('media.video')}>
          <Icon name="play" size={15} />
        </span>
      ) : null}
      {(!url || pending) && (
        <div className="photo-upload-overlay">
          <span className="photo-upload-spinner" role="status" aria-label={t('common.loading')} />
        </div>
      )}
    </div>
  )
}
