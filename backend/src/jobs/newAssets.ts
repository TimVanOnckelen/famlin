import { prisma } from '../db.js';
import { getMediaProvider } from '../services/media/registry.js';
import { notifyGroup, SYSTEM_SENDER_ID } from '../services/notifications.js';
import { getAllSettings } from '../services/settings.js';
import { emitDomainEvent } from '../events.js';
import i18n from '../i18n/index.js';
import type { MediaAssetSummary } from '../services/media/types.js';

// A post created in AUTO mode embeds at most this many of the new assets —
// mirrors the 20-asset cap createPostBodySchema enforces on a normal post,
// kept smaller since these are machine-generated and shouldn't dominate the
// feed with a huge gallery.
const MAX_ASSETS_PER_AUTO_POST = 10;

// Builds the exact proxy URL shape routes/media.ts serves, and picks the
// same rendition the web/mobile media picker attaches to a hand-composed
// post (NewPostModal.tsx / MediaPickerModal.tsx's onConfirm): `preview` for
// images (the `original` is too heavy to embed directly), the real
// `original` for videos (Immich's `preview`/`thumbnail` are always a JPEG
// still, never playable video).
function buildAssetUrl(linkId: string, asset: MediaAssetSummary): string {
  const variantExt = asset.type === 'VIDEO' ? `original.${asset.originalExt}` : 'preview.jpg';
  return `/api/media/assets/${linkId}/${asset.id}/${variantExt}`;
}

// Runs hourly (see registerCronJobs in server.ts): for every MediaAlbumLink
// with newAssetMode != OFF, checks whether the source has assets added since
// the last run and, depending on the mode, notifies the group (MANUAL) or
// creates a real Post with the new assets attached (AUTO).
export async function runNewAssetsJob(now = new Date()): Promise<void> {
  const links = await prisma.mediaAlbumLink.findMany({
    where: { newAssetMode: { not: 'OFF' } },
    include: { group: { select: { id: true, name: true } } },
  });
  if (links.length === 0) return;

  const settings = await getAllSettings();
  const t = i18n.getFixedT(settings.defaultLanguage);

  for (const link of links) {
    try {
      const provider = getMediaProvider(link.provider);
      if (!provider) {
        console.warn(`newAssets job: unknown provider "${link.provider}" for link ${link.id}, skipping`);
        continue;
      }

      // First run for this link — initialize the watermark only. Treating
      // an album's entire pre-existing history as "new" on the very first
      // scan would spam (or bulk-post) everything it already contained.
      if (!link.newAssetsCheckedAt) {
        await prisma.mediaAlbumLink.update({ where: { id: link.id }, data: { newAssetsCheckedAt: now } });
        continue;
      }

      const since = link.newAssetsCheckedAt;
      const assets = await provider.listAlbumAssets(link.externalAlbumId);
      const newAssets = assets.filter((asset) => asset.addedAt && new Date(asset.addedAt) > since);

      if (newAssets.length === 0) {
        await prisma.mediaAlbumLink.update({ where: { id: link.id }, data: { newAssetsCheckedAt: now } });
        continue;
      }

      if (link.newAssetMode === 'MANUAL') {
        await notifyGroup({
          type: 'new_media_assets',
          groupId: link.groupId,
          senderId: SYSTEM_SENDER_ID,
          // Not tied to a Post — notifyGroup/notify() treat a missing postId
          // as null (see services/notifications.ts).
          params: { count: newAssets.length, album: link.albumName, group: link.group.name },
        });
        await prisma.mediaAlbumLink.update({ where: { id: link.id }, data: { newAssetsCheckedAt: now } });
        continue;
      }

      // AUTO: author the post as an admin — prefer one who's actually a
      // member of this group (so the post reads as coming from within the
      // family), falling back to any admin. If the deployment somehow has no
      // admin at all, skip this link *without* advancing the watermark, so
      // the same new assets are retried on the next run instead of being
      // silently dropped once an admin does exist.
      const groupAdminMembership = await prisma.groupMember.findFirst({
        where: { groupId: link.groupId, user: { isAdmin: true } },
        include: { user: true },
      });
      const author = groupAdminMembership?.user ?? (await prisma.user.findFirst({ where: { isAdmin: true } }));

      if (!author) {
        console.warn(`newAssets job: no admin user available to author a post for link ${link.id}, skipping`);
        continue;
      }

      const content = t('media.newAssetsPostContent', { count: newAssets.length, album: link.albumName });
      const uploadedAssetUrls = newAssets
        .slice(0, MAX_ASSETS_PER_AUTO_POST)
        .map((asset) => buildAssetUrl(link.id, asset));

      const post = await prisma.post.create({
        data: {
          authorId: author.id,
          groupId: link.groupId,
          content,
          type: 'UPDATE',
          uploadedAssetUrls,
        },
      });

      // Fire-and-forget by design (see events.ts) — the notifications
      // subscriber turns this into the same 'new_post' notifications a
      // human-authored post would trigger.
      emitDomainEvent('post.created', {
        posts: [{ postId: post.id, groupId: link.groupId, groupName: link.group.name }],
        authorId: author.id,
        authorName: author.name,
        content: post.content,
      });

      await prisma.mediaAlbumLink.update({ where: { id: link.id }, data: { newAssetsCheckedAt: now } });
    } catch (err) {
      // One broken provider/link must never stop the rest of the run.
      console.error(`newAssets job failed for link ${link.id}`, err);
    }
  }
}
