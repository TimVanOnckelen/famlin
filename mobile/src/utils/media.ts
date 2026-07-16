const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.m4v', '.webm'];

export function isVideoUrl(url: string): boolean {
  const path = url.split('?')[0].toLowerCase();
  return VIDEO_EXTENSIONS.some((ext) => path.endsWith(ext));
}

// Derives the server-generated poster-frame URL for a video URL, or null when
// no poster can exist (local file:// picker URIs, unrecognized shapes):
// - direct uploads:  /uploads/<uuid>.mp4 -> /uploads/<uuid>-thumbnail.jpg
//   (written at upload time by the backend's generateVideoPoster — may 404
//   for uploads that predate poster generation, so callers need a fallback)
// - media proxy (incl. legacy /api/immich): .../assets/<linkId>/<assetId>/
//   original.mp4 -> .../thumbnail.jpg (thumbnail renditions are always .jpg,
//   see the backend's parseMediaAssetPath)
export function getVideoPosterUrl(url: string): string | null {
  const [path, query] = url.split('?');
  const lower = path.toLowerCase();
  const ext = VIDEO_EXTENSIONS.find((e) => lower.endsWith(e));
  if (!ext) return null;
  const q = query ? `?${query}` : '';

  if (lower.includes('/uploads/')) {
    return `${path.slice(0, -ext.length)}-thumbnail.jpg${q}`;
  }

  const segments = path.split('/');
  const last = segments[segments.length - 1].toLowerCase();
  if (last.startsWith('original.') && lower.includes('/assets/')) {
    segments[segments.length - 1] = 'thumbnail.jpg';
    return `${segments.join('/')}${q}`;
  }

  return null;
}
