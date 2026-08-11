const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.m4v', '.webm'];

// Asset URLs are either /uploads/<uuid>.<ext> or a media proxy path
// (/api/media/... or the legacy /api/immich/...) ending in the variant
// extension — a plain extension check covers all of them.
export function isVideoUrl(assetUrl: string): boolean {
  const path = assetUrl.split('?')[0].toLowerCase();
  return VIDEO_EXTENSIONS.some((ext) => path.endsWith(ext));
}

// HEIC/HEIF — the iPhone camera's default format — is undecodable in every
// browser but Safari, so a blob: preview of a freshly picked .heic renders as
// a broken image. Uploading it works fine (the backend converts it to JPEG),
// so composers show a neutral placeholder tile instead of a broken <img>.
// Server-side URLs need no such check: /uploads/*.heic is served as a
// generated JPEG (see backend/src/services/uploadVariants.ts).
const UNDECODABLE_IMAGE_TYPES = ['image/heic', 'image/heif'];
const UNDECODABLE_IMAGE_EXTENSIONS = ['.heic', '.heif'];

export function isBrowserDecodableImage(file: File): boolean {
  // Chrome on some platforms reports an empty type for .heic, so the filename
  // is the more reliable of the two signals — check both.
  if (UNDECODABLE_IMAGE_TYPES.includes(file.type.toLowerCase())) return false;
  const name = file.name.toLowerCase();
  return !UNDECODABLE_IMAGE_EXTENSIONS.some((ext) => name.endsWith(ext));
}

// The format badge shown on that placeholder — the file's extension, or a
// generic label for a file whose name carries none.
export function fileFormatLabel(file: File): string {
  const dotIndex = file.name.lastIndexOf('.');
  return dotIndex > 0 ? file.name.slice(dotIndex + 1).toUpperCase() : 'IMG';
}
