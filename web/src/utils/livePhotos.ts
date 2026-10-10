export interface PickedAttachment<T extends Pick<File, 'name'> = File> { file: T; motionFile?: T }

export function groupLivePhotoFiles<T extends Pick<File, 'name'>>(files: T[]): PickedAttachment<T>[] {
  const stem = (file: T) => file.name.replace(/\.[^.]+$/, '').toLowerCase();
  const groups = new Map<string, T[]>();
  for (const file of files) {
    const key = stem(file);
    groups.set(key, [...(groups.get(key) ?? []), file]);
  }
  const used = new Set<T>();
  const attachments: PickedAttachment<T>[] = [];
  for (const file of files) {
    if (used.has(file)) continue;
    const group = groups.get(stem(file))!;
    const photos = group.filter((item) => /\.(heic|heif|jpe?g)$/i.test(item.name));
    const videos = group.filter((item) => /\.mov$/i.test(item.name));
    if (photos.length === 1 && videos.length === 1) {
      attachments.push({ file: photos[0], motionFile: videos[0] });
      used.add(photos[0]); used.add(videos[0]);
    } else {
      attachments.push({ file }); used.add(file);
    }
  }
  return attachments;
}
