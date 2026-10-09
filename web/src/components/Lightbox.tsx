import { useEffect, useState } from 'react';
import { UploadMedia } from '@/components/UploadMedia';
import './PostCard.css';

// Shared by PostCard.tsx (a post's photo gallery) and CommentsSection.tsx (a
// comment's own attachment) — styled by PostCard.css's .lightbox* rules.
export function Lightbox({
  assetUrls,
  initialIndex,
  onClose,
}: {
  assetUrls: string[];
  initialIndex: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(initialIndex);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1));
      if (e.key === 'ArrowRight') setIndex((i) => Math.min(assetUrls.length - 1, i + 1));
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [assetUrls.length, onClose]);


  return (
    <div className="lightbox" onClick={onClose} role="dialog" aria-modal>
      {index > 0 && (
        <button
          className="lightbox-nav lightbox-prev"
          onClick={(e) => {
            e.stopPropagation();
            setIndex(index - 1);
          }}
          aria-label="‹"
        >
          ‹
        </button>
      )}
      <UploadMedia key={assetUrls[index]} url={assetUrls[index]} className="lightbox-media" autoPlay onClick={(e) => e.stopPropagation()} />
      {index < assetUrls.length - 1 && (
        <button
          className="lightbox-nav lightbox-next"
          onClick={(e) => {
            e.stopPropagation();
            setIndex(index + 1);
          }}
          aria-label="›"
        >
          ›
        </button>
      )}
    </div>
  );
}
