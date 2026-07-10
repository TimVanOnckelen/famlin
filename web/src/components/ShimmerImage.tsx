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
  alt = '',
  className,
  loading,
  onClick,
}: {
  src: string;
  alt?: string;
  className?: string;
  loading?: 'lazy' | 'eager';
  onClick?: (e: MouseEvent<HTMLElement>) => void;
}) {
  // Track which src finished loading (not a boolean) so a src change — the
  // Lightbox reuses one instance while navigating — re-shows the shimmer.
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const loaded = loadedSrc === src;

  return (
    <span className={`shimmer-frame${loaded ? ' shimmer-frame-loaded' : ''}`} onClick={onClick}>
      <img
        src={src}
        alt={alt}
        className={className}
        loading={loading}
        // A cached image can already be complete before onLoad is attached.
        ref={(el) => {
          if (el?.complete) setLoadedSrc(src);
        }}
        onLoad={() => setLoadedSrc(src)}
        onError={() => setLoadedSrc(src)}
      />
    </span>
  );
}
