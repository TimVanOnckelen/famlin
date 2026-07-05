import { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { authenticateMediaRequest } from '../plugins/auth.js';
import { isGroupMember } from '../services/groups.js';
import {
  getImmichAlbumAssets,
  getImmichAlbumInfo,
  isAssetInAlbum,
  proxyImmichAsset,
  immichErrorKey,
  immichErrorStatus,
  ImmichError,
} from '../services/immich.js';
import { parseImmichAssetPath } from '../types.js';
import { getT } from '../i18n/index.js';

// Member-facing and deliberately read/proxy-only, same spirit as
// routes/groups.ts — linking albums to a group is an admin mutation and
// lives in routes/admin.ts instead.
export default async function immichRoutes(fastify: FastifyInstance) {
  fastify.get('/groups/:groupId/albums', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const t = getT(request);
    const { groupId } = request.params as { groupId: string };

    if (!(await isGroupMember(groupId, request.user!.id))) {
      return reply.status(403).send({ error: t('errors.notGroupMember') });
    }

    const links = await prisma.immichAlbumLink.findMany({ where: { groupId }, orderBy: { createdAt: 'desc' } });
    if (links.length === 0) return [];

    try {
      // Per-link lookup rather than listImmichAlbums()'s full-instance
      // catalog — a group typically has one or two linked albums, so this
      // doesn't scale with the size of the whole Immich library.
      return await Promise.all(
        links.map(async (link) => ({
          linkId: link.id,
          albumName: link.albumName,
          assetCount: (await getImmichAlbumInfo(link.immichAlbumId))?.assetCount ?? 0,
        }))
      );
    } catch (err) {
      if (err instanceof ImmichError) return reply.status(immichErrorStatus(err)).send({ error: t(immichErrorKey(err)) });
      throw err;
    }
  });

  fastify.get('/albums/:linkId/assets', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const t = getT(request);
    const { linkId } = request.params as { linkId: string };

    const link = await prisma.immichAlbumLink.findUnique({ where: { id: linkId } });
    if (!link) return reply.status(404).send({ error: t('errors.immichAlbumLinkNotFound') });

    if (!(await isGroupMember(link.groupId, request.user!.id))) {
      return reply.status(403).send({ error: t('errors.notGroupMember') });
    }

    try {
      const assets = await getImmichAlbumAssets(link.immichAlbumId);
      return assets.map((asset) => {
        // thumbnail/preview always come back from Immich as a JPEG still
        // (even for a video) — see proxyImmichAsset/types.ts. Only the
        // original rendition can be the asset's real video file.
        const originalExt = asset.type === 'VIDEO' ? 'mp4' : 'jpg';
        return {
          assetId: asset.id,
          type: asset.type,
          width: asset.width,
          height: asset.height,
          thumbnailUrl: `/api/immich/assets/${link.id}/${asset.id}/thumbnail.jpg`,
          previewUrl: `/api/immich/assets/${link.id}/${asset.id}/preview.jpg`,
          originalUrl: `/api/immich/assets/${link.id}/${asset.id}/original.${originalExt}`,
        };
      });
    } catch (err) {
      if (err instanceof ImmichError) return reply.status(immichErrorStatus(err)).send({ error: t(immichErrorKey(err)) });
      throw err;
    }
  });

  // No fastify.authenticate here: this is loaded as an <Image>/<Video> `uri`,
  // which can't send custom headers, so it must accept the same dual auth
  // (session token or media token) that gates /uploads/* — see
  // authenticateMediaRequest in plugins/auth.ts.
  fastify.get('/assets/:linkId/:assetId/:variantExt', async (request, reply) => {
    const t = getT(request);
    const userId = await authenticateMediaRequest(request);
    if (!userId) return reply.status(401).send({ error: t('errors.unauthorized') });

    const { linkId, assetId, variantExt } = request.params as { linkId: string; assetId: string; variantExt: string };
    const parsed = parseImmichAssetPath(`/api/immich/assets/${linkId}/${assetId}/${variantExt}`);
    if (!parsed) {
      return reply.status(404).send({ error: t('errors.immichAlbumLinkNotFound') });
    }

    const link = await prisma.immichAlbumLink.findUnique({ where: { id: linkId } });
    if (!link) return reply.status(404).send({ error: t('errors.immichAlbumLinkNotFound') });

    if (!(await isGroupMember(link.groupId, userId))) {
      return reply.status(403).send({ error: t('errors.notGroupMember') });
    }

    try {
      // The linkId->groupId check above only proves the requester belongs to
      // the group this album is linked to — it doesn't prove the requested
      // asset is actually in that album. Since the server-level API key can
      // read any asset on the Immich instance, re-check membership here too;
      // otherwise a member who learns an asset id from elsewhere (e.g.
      // another group's post) could read assets never linked to Famlin.
      if (!(await isAssetInAlbum(link.immichAlbumId, assetId))) {
        return reply.status(404).send({ error: t('errors.immichAlbumLinkNotFound') });
      }

      return await proxyImmichAsset(assetId, parsed.variant, reply);
    } catch (err) {
      if (err instanceof ImmichError) return reply.status(immichErrorStatus(err)).send({ error: t(immichErrorKey(err)) });
      throw err;
    }
  });
}
