import { useState, type MouseEvent } from 'react';
import './ShimmerImage.css';

// An <img> that shows an animated shimmer placeholder until the photo arrives.
// Server photos stream through the backend proxy (uploads/Immich/local media),
// which can be slow — without this the space is blank while the bytes arrive.
// The wrapper span carries the shimmer; how much space it reserves while empty
// is the call site's job (e.g. `.post-hero .shimmer-frame` gets an
// aspect-ratio in PostCard.css). onClick lives on the wrapper so the
// placeholder area is clickable too.
export function ShimmerImage({
  src,
  fallbackSrc,
  alt = '',
  className,
  loading,
  onClick,
}: {
  src: string;
  // Retried once if `src` fails to load — for a `?variant=thumbnail`-style
  // URL (see getUploadUrl in @famlin/api-client) that 404s because the
  // upload predates thumbnail generation, or the source format couldn't be
  // resized server-side.
  fallbackSrc?: string;
  alt?: string;
  className?: string;
  loading?: 'lazy' | 'eager';
  onClick?: (e: MouseEvent<HTMLElement>) => void;
}) {
  // Track which src finished loading (not a boolean) so a src change — the
  // Lightbox reuses one instance while navigating — re-shows the shimmer.
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [fellBack, setFellBack] = useState(false);
  const effectiveSrc = fellBack && fallbackSrc ? fallbackSrc : src;
  const loaded = loadedSrc === effectiveSrc;

  return (
    <span className={`shimmer-frame${loaded ? ' shimmer-frame-loaded' : ''}`} onClick={onClick}>
      <img
        src={effectiveSrc}
        alt={alt}
        className={className}
        loading={loading}
        // A cached image can already be complete before onLoad is attached.
        ref={(el) => {
          if (el?.complete) setLoadedSrc(effectiveSrc);
        }}
        onLoad={() => setLoadedSrc(effectiveSrc)}
        onError={() => {
          if (fallbackSrc && effectiveSrc !== fallbackSrc) {
            setFellBack(true);
          } else {
            setLoadedSrc(effectiveSrc);
          }
        }}
      />
    </span>
  );
}
