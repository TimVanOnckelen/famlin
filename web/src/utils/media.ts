const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.m4v', '.webm'];

// Asset URLs are either /uploads/<uuid>.<ext> or an Immich proxy path ending
// in the variant extension (.jpg/.mp4) — a plain extension check covers both.
export function isVideoUrl(assetUrl: string): boolean {
  const path = assetUrl.split('?')[0].toLowerCase();
  return VIDEO_EXTENSIONS.some((ext) => path.endsWith(ext));
}
