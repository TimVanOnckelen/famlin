import { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { authenticateMediaRequest, requireGroupMember } from '../plugins/auth.js';
import { isGroupMember } from '../services/groups.js';
import { getMediaProvider } from '../services/media/registry.js';
import {
  authorizeAndStreamAsset,
  findAlbumLinkOrNotFound,
  findGroupAlbumLinks,
  listAndMapAlbumAssets,
  resolveProviderOr404,
  respondWithAlbumList,
} from '../services/media/routeHelpers.js';
import { resolvePersonFilterForAlbum } from '../services/media/personFilter.js';
import { getGroupPhotoTimeline } from '../services/media/photoTimeline.js';
import { parseMediaAssetPath, photoTimelineQuerySchema } from '../types.js';
import { getT } from '../i18n/index.js';

const MEDIA_ASSET_URL_PREFIX = '/api/media/assets';
const NOT_FOUND_KEY = 'errors.mediaAlbumLinkNotFound';

// Member-facing, provider-generic media endpoints — read/proxy-only, same
// spirit as routes/groups.ts; linking albums to a group is an admin mutation
// in routes/admin.ts. The legacy Immich-only equivalents in routes/immich.ts
// stay because their URL shapes are stored in existing posts and generated
// by pre-built mobile clients; new clients should use these instead. Shared
// plumbing with routes/immich.ts lives in services/media/routeHelpers.ts.
export default async function mediaRoutes(fastify: FastifyInstance) {
  fastify.get('/groups/:groupId/albums', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const t = getT(request);
    const { groupId } = request.params as { groupId: string };

    if (await requireGroupMember(request, reply, groupId)) return;

    const links = await findGroupAlbumLinks(groupId);
    if (links.length === 0) return [];

    // Per-link lookup rather than each provider's full catalog — a group
    // typically has one or two linked albums. A link whose provider is
    // failing reports assetCount 0 rather than sinking the whole list, so one
    // unreachable source can't hide the others' albums.
    return respondWithAlbumList(reply, t, links, {
      resolveProvider: (link) => getMediaProvider(link.provider),
      failSoft: true,
      includeProviderField: true,
    });
  });

  // Merged, capture-date-ordered photo feed across every linked album in the
  // group *and* photos uploaded directly to the group's posts — the "camera
  // roll" view, as opposed to /groups/:groupId/albums' per-album browse.
  // See services/media/photoTimeline.ts for the merge/cursor logic.
  fastify.get('/groups/:groupId/photos', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const t = getT(request);
    const { groupId } = request.params as { groupId: string };
    const { cursor, take, personId } = photoTimelineQuerySchema.parse(request.query);

    if (await requireGroupMember(request, reply, groupId)) return;

    const result = await getGroupPhotoTimeline(groupId, { cursor, take, personId });
    if (!result.ok) return reply.status(result.status).send({ error: t(result.errorKey) });

    return { items: result.items, nextCursor: result.nextCursor };
  });

  fastify.get('/albums/:linkId/assets', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const t = getT(request);
    const { linkId } = request.params as { linkId: string };
    // externalPersonId (not the MediaPersonLink row id) — filters the album
    // down to one recognized person via set intersection.
    const { personId } = request.query as { personId?: string };

    const found = await findAlbumLinkOrNotFound(linkId, { notFoundErrorKey: NOT_FOUND_KEY });
    if (!found.ok) return reply.status(found.status).send({ error: t(found.errorKey) });
    const { link } = found;

    if (await requireGroupMember(request, reply, link.groupId)) return;

    const providerResult = resolveProviderOr404(link, {
      resolveProvider: (l) => getMediaProvider(l.provider),
      notFoundErrorKey: NOT_FOUND_KEY,
    });
    if (!providerResult.ok) return reply.status(providerResult.status).send({ error: t(providerResult.errorKey) });

    let personAssetIds: Set<string> | null = null;
    if (personId) {
      // Shared with the merged photo timeline's ?personId= filter — see
      // resolvePersonFilterForAlbum's doc comment.
      const result = await resolvePersonFilterForAlbum(link, personId);
      if (!result.ok) return reply.status(result.status).send({ error: t(result.errorKey) });
      personAssetIds = result.assetIds;
    }

    return listAndMapAlbumAssets(providerResult.provider, link, MEDIA_ASSET_URL_PREFIX, reply, t, personAssetIds);
  });

  // Mapped people for every media source a group has at least one linked
  // album on — the member-facing "filter by person" picker's catalog. Empty
  // array (not an error) when the group has no linked albums or none of its
  // providers have any mapped people.
  fastify.get('/people', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const t = getT(request);
    const { groupId } = request.query as { groupId?: string };
    if (!groupId) return reply.status(400).send({ error: t('errors.groupIdRequired') });

    if (await requireGroupMember(request, reply, groupId)) return;

    const links = await prisma.mediaAlbumLink.findMany({ where: { groupId }, select: { provider: true } });
    const providerIds = [...new Set(links.map((l) => l.provider))];
    if (providerIds.length === 0) return [];

    const people = await prisma.mediaPersonLink.findMany({
      where: { provider: { in: providerIds } },
      orderBy: { createdAt: 'asc' },
    });

    // Collapse to one entry per (provider, label): the same real person can
    // be mapped once per Immich library owner, all sharing a label — that's
    // the cross-owner merge mechanism (see resolvePersonFilterForAlbum in
    // personFilter.ts). Prefer the row with a userId (mirrors the tie-break in
    // personTags.ts's attachPeopleToPosts), otherwise keep the earliest-created
    // row. The chosen externalPersonId still works as `?personId=` for every
    // sibling row, since the person filter is label-aware within a provider.
    const byProviderLabel = new Map<string, (typeof people)[number]>();
    for (const p of people) {
      const key = `${p.provider}::${p.label}`;
      const existing = byProviderLabel.get(key);
      if (!existing || (!existing.userId && p.userId)) byProviderLabel.set(key, p);
    }

    return [...byProviderLabel.values()].map((p) => ({
      id: p.externalPersonId,
      provider: p.provider,
      label: p.label,
      userId: p.userId,
    }));
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
    const parsed = parseMediaAssetPath(`${MEDIA_ASSET_URL_PREFIX}/${linkId}/${assetId}/${variantExt}`);
    if (!parsed) {
      return reply.status(404).send({ error: t(NOT_FOUND_KEY) });
    }

    const found = await findAlbumLinkOrNotFound(linkId, { notFoundErrorKey: NOT_FOUND_KEY });
    if (!found.ok) return reply.status(found.status).send({ error: t(found.errorKey) });
    const { link } = found;

    if (!(await isGroupMember(link.groupId, userId))) {
      return reply.status(403).send({ error: t('errors.notGroupMember') });
    }

    const providerResult = resolveProviderOr404(link, {
      resolveProvider: (l) => getMediaProvider(l.provider),
      notFoundErrorKey: NOT_FOUND_KEY,
    });
    if (!providerResult.ok) return reply.status(providerResult.status).send({ error: t(providerResult.errorKey) });

    return authorizeAndStreamAsset(
      providerResult.provider,
      link,
      assetId,
      parsed.variant,
      reply,
      request.headers.range,
      NOT_FOUND_KEY,
      t
    );
  });
}
