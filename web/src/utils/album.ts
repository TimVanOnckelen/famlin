import { Comment } from '@famlin/api-client';

// Web helpers for the ALBUM post type — mirrors utils/trip.ts. An album's
// photos live on its photo-contribution comments (metadata.kind ===
// 'album_photo'), each of which can carry several photoUrls plus an optional
// caption (Comment.content); ordinary comments on the album have no metadata.

export interface AlbumPhoto {
  url: string;
  // The contribution comment this photo came from — carries the contributor
  // (author), caption (content), and createdAt, and is what a per-photo
  // like/comment view would hang off (mirrors trip check-in comments).
  comment: Comment;
}

// Flattens a post's album-photo contribution comments into a single
// newest-first list of photos for the detail grid. A single contribution can
// add several photos at once, so one comment may yield several entries.
export function collectAlbumPhotos(comments: Comment[]): AlbumPhoto[] {
  const contributions = comments
    .filter((c) => !c.parentId && c.metadata?.kind === 'album_photo')
    // Newest contribution first.
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

// The album's ordinary comments — everything that isn't a photo contribution
// or a reply. Used to feed CommentsSection's filterComments so the discussion
// section stays separate from the photo grid.
export function isAlbumDiscussionComment(comment: Comment): boolean {
  return comment.metadata?.kind !== 'album_photo';
}
