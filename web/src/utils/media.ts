const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.m4v', '.webm'];

// Asset URLs are either /uploads/<uuid>.<ext> or a media proxy path
// (/api/media/... or the legacy /api/immich/...) ending in the variant
// extension — a plain extension check covers all of them.
export function isVideoUrl(assetUrl: string): boolean {
  const path = assetUrl.split('?')[0].toLowerCase();
  return VIDEO_EXTENSIONS.some((ext) => path.endsWith(ext));
}
