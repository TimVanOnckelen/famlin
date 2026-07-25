import { Comment } from '@/types';

// Mobile helpers for the ALBUM post type — mirrors web's utils/album.ts. An
// album's photos live on its photo-contribution comments (metadata.kind ===
// 'album_photo'), each carrying photoUrls plus an optional caption
// (Comment.content); ordinary comments on the album have no metadata.

export interface AlbumPhoto {
  url: string;
  comment: Comment;
}

// Flattens a post's album-photo contribution comments into a single
// newest-first list of photos for the detail grid. One contribution can add
// several photos, so one comment may yield several entries.
export function collectAlbumPhotos(comments: Comment[]): AlbumPhoto[] {
  const contributions = comments
    .filter((c) => !c.parentId && c.metadata?.kind === 'album_photo')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const photos: AlbumPhoto[] = [];
  for (const comment of contributions) {
    const urls = comment.metadata?.kind === 'album_photo' ? comment.metadata.photoUrls : [];
    for (const url of urls) {
      photos.push({ url, comment });
    }
  }
  return photos;
}

// The album's ordinary comments — everything that isn't a photo contribution.
export function isAlbumDiscussionComment(comment: Comment): boolean {
  return comment.metadata?.kind !== 'album_photo';
}
