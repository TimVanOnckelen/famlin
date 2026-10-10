import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { getUploadUrl } from '@famlin/api-client';
import { LivePhotoIcon } from './LivePhotoIcon';

export function LivePhoto({ imageUrl, videoUrl, className, onClick }: {
  imageUrl: string; videoUrl: string; className?: string; onClick?: (event: MouseEvent<HTMLElement>) => void;
}) {
  const { t } = useTranslation();
  const container = useRef<HTMLDivElement>(null);
  const player = useRef<HTMLVideoElement>(null);
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(false);
  const [activated, setActivated] = useState(false);
  const [pageVisible, setPageVisible] = useState(!document.hidden);
  const [started, setStarted] = useState(false);
  const [playFailed, setPlayFailed] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      setVisible(entry.isIntersecting);
      if (entry.isIntersecting) setActivated(true);
    }, { threshold: 0.1 });
    if (container.current) observer.observe(container.current);
    const onVisibility = () => setPageVisible(!document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', onVisibility); };
  }, []);
  useEffect(() => {
    const video = player.current;
    if (!video) return;
    if (visible && pageVisible && !paused) {
      let canceled = false;
      video.play().then(() => { if (!canceled) { setStarted(true); setPlayFailed(false); } }).catch(() => { if (!canceled) setPlayFailed(true); });
      return () => { canceled = true; video.pause(); };
    } else video.pause();
  }, [visible, pageVisible, paused, videoUrl]);
  const activate = (event: MouseEvent<HTMLElement>) => {
    if (onClick) onClick(event);
  };
  const showMotion = started && !playFailed && !paused;
  return <div ref={container} className={`live-photo ${className ?? ''}`} onClick={activate}>
    <img src={getUploadUrl(imageUrl)} alt="" className={showMotion ? 'live-photo-still-hidden' : undefined} />
    <video ref={player} src={activated ? getUploadUrl(videoUrl) : undefined} poster={getUploadUrl(imageUrl)}
      muted loop playsInline preload="none" className={!showMotion ? 'live-photo-motion-hidden' : undefined} />
    {onClick && <button type="button" className="live-photo-open" aria-label={t('media.livePhoto')} onClick={(event) => { event.stopPropagation(); onClick(event); }} />}
    <button type="button" className={`live-photo-toggle${paused || playFailed ? ' live-photo-paused' : ''}`}
      aria-label={t(paused || playFailed ? 'media.playLivePhoto' : 'media.pauseLivePhoto')}
      aria-pressed={!paused && !playFailed}
      onClick={(event) => {
        event.stopPropagation();
        if (playFailed && player.current) {
          player.current.play().then(() => { setStarted(true); setPlayFailed(false); setPaused(false); }).catch(() => {});
        } else setPaused((value) => !value);
      }}>
      <LivePhotoIcon size={20} /><span>LIVE</span>
    </button>
  </div>;
}
