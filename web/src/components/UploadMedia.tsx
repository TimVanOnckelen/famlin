import { useExclusiveVideo } from '@/hooks/useExclusiveVideo'
import { LivePhoto } from './LivePhoto'
import { useUploadProcessing } from '@/hooks/useUploadProcessing'
import { useEffect, useRef, useState, type MouseEvent, type VideoHTMLAttributes } from 'react'
import { useTranslation } from 'react-i18next'
import { getUploadUrl } from '@famlin/api-client'
import { ShimmerImage } from './ShimmerImage'
import { Icon } from './Icon'
import { isVideoUrl } from '@/utils/media'
import './UploadMedia.css'

function VideoPreview({
  src,
  className,
  onClick,
}: {
  src: string
  className?: string
  onClick?: (event: MouseEvent<HTMLElement>) => void
}) {
  const { t } = useTranslation()
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const content = (
    <>
      {failedSrc !== src && <img src={src} alt="" loading="lazy" onError={() => setFailedSrc(src)} />}
      <span className="media-video-play" aria-hidden>
        <Icon name="play" size={26} />
      </span>
    </>
  )
  const classes = `media-video-preview ${className ?? ''}${failedSrc === src ? ' media-video-poster-missing' : ''}`
  return onClick ? (
    <button type="button" className={classes} onClick={onClick} aria-label={t('media.playVideo')}>
      {content}
    </button>
  ) : (
    <span className={classes}>{content}</span>
  )
}

function VideoMedia(props: VideoHTMLAttributes<HTMLVideoElement>) {
  const player = useRef<HTMLVideoElement>(null)
  useExclusiveVideo(player)
  useEffect(() => {
    const video = player.current
    if (!video || !props.autoPlay) return
    let canceled = false
    video.play().catch(async (error: unknown) => {
      if (canceled || !(error instanceof DOMException) || error.name !== 'NotAllowedError') return
      // Browsers can require silent playback when media becomes ready after
      // the opening gesture. Native controls still allow enabling sound.
      video.muted = true
      await video.play().catch(() => {})
    })
    return () => {
      canceled = true
    }
  }, [props.autoPlay, props.src])
  return <video ref={player} {...props} />
}

export function UploadMedia({
  url,
  className,
  thumbnail = false,
  thumbnailUrl,
  onClick,
  autoPlay = false,
}: {
  url: string
  className?: string
  thumbnail?: boolean
  thumbnailUrl?: string
  onClick?: (event: MouseEvent<HTMLElement>) => void
  autoPlay?: boolean
}) {
  const { t } = useTranslation()
  const state = useUploadProcessing(url)
  const previewUrl = thumbnailUrl ?? state.thumbnailUrl
  if (state.pending || state.failed) {
    return (
      <div className={`media-processing ${className ?? ''}`} role="status">
        {state.thumbnailUrl && <img src={getUploadUrl(state.thumbnailUrl)} alt="" />}
        <span>{t(state.failed ? 'media.processingFailed' : 'media.processing')}</span>
      </div>
    )
  }
  if (state.kind === 'livePhoto' && state.videoUrl) {
    return (
      <LivePhoto
        key={url}
        imageUrl={thumbnail && previewUrl ? previewUrl : url}
        videoUrl={state.videoUrl}
        className={className}
        onClick={onClick}
        autoPlay={autoPlay}
      />
    )
  }
  if (isVideoUrl(url)) {
    if (thumbnail) {
      return (
        <VideoPreview
          src={previewUrl ? getUploadUrl(previewUrl) : getUploadUrl(url, 'thumbnail')}
          className={className}
          onClick={onClick}
        />
      )
    }
    return (
      <VideoMedia
        src={getUploadUrl(url)}
        className={className}
        controls
        preload="metadata"
        autoPlay={autoPlay}
        onClick={onClick}
      />
    )
  }
  const src = thumbnail ? (previewUrl ? getUploadUrl(previewUrl) : getUploadUrl(url, 'thumbnail')) : getUploadUrl(url)
  return (
    <ShimmerImage src={src} fallbackSrc={getUploadUrl(url)} className={className} loading="lazy" onClick={onClick} />
  )
}
