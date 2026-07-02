const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.m4v', '.webm'];

export function isVideoUrl(url: string): boolean {
  const path = url.split('?')[0].toLowerCase();
  return VIDEO_EXTENSIONS.some((ext) => path.endsWith(ext));
}
