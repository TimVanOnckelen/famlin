import { LivePhoto } from './LivePhoto';
import { useUploadProcessing } from '@/hooks/useUploadProcessing';
import { useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { getUploadUrl } from '@famlin/api-client';
import { ShimmerImage } from './ShimmerImage';
import { Icon } from './Icon';
import { isVideoUrl } from '@/utils/media';
import './UploadMedia.css';

function VideoPreview({ src, className, onClick }: {
  src: string; className?: string; onClick?: (event: MouseEvent<HTMLElement>) => void;
}) {
  const { t } = useTranslation();
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const content = <>
    {failedSrc !== src && <img src={src} alt="" loading="lazy" onError={() => setFailedSrc(src)} />}
    <span className="media-video-play" aria-hidden><Icon name="play" size={26} /></span>
  </>;
  const classes = `media-video-preview ${className ?? ''}${failedSrc === src ? ' media-video-poster-missing' : ''}`;
  return onClick
    ? <button type="button" className={classes} onClick={onClick} aria-label={t('media.playVideo')}>{content}</button>
    : <span className={classes}>{content}</span>;
}

export function UploadMedia({ url, className, thumbnail = false, onClick, autoPlay = false }: {
  url: string; className?: string; thumbnail?: boolean;
  onClick?: (event: MouseEvent<HTMLElement>) => void; autoPlay?: boolean;
}) {
  const { t } = useTranslation();
  const state = useUploadProcessing(url);
  if (state.pending || state.failed) {
    return <div className={`media-processing ${className ?? ''}`} role="status">
      {state.thumbnailUrl && <img src={getUploadUrl(state.thumbnailUrl)} alt="" />}
      <span>{t(state.failed ? 'media.processingFailed' : 'media.processing')}</span>
    </div>;
  }
  if (state.kind === 'livePhoto' && state.videoUrl) {
    return <LivePhoto key={url} imageUrl={thumbnail && state.thumbnailUrl ? state.thumbnailUrl : url}
      videoUrl={state.videoUrl} className={className} onClick={onClick} />;
  }
  if (isVideoUrl(url)) {
    if (thumbnail) {
      return <VideoPreview src={state.thumbnailUrl ? getUploadUrl(state.thumbnailUrl) : getUploadUrl(url, 'thumbnail')} className={className} onClick={onClick} />;
    }
    return <video src={getUploadUrl(url)} className={className} controls preload="metadata" autoPlay={autoPlay} onClick={onClick} />;
  }
  const src = thumbnail ? (state.thumbnailUrl ? getUploadUrl(state.thumbnailUrl) : getUploadUrl(url, 'thumbnail')) : getUploadUrl(url);
  return <ShimmerImage src={src} fallbackSrc={getUploadUrl(url)} className={className} loading="lazy" onClick={onClick} />;
}
