import { prisma } from '../../db.js';
import { getMediaProvider, mediaErrorKey, mediaErrorStatus } from './registry.js';
import { MediaProviderError } from './types.js';

export type PersonFilterOutcome =
  | { ok: true; assetIds: Set<string> }
  | { ok: false; status: number; errorKey: string };

// Resolves the label-aware set of asset ids within one linked album that are
// tagged with `personId` (a MediaPersonLink.externalPersonId for this link's
// provider). Shared by routes/media.ts's single-album `?personId=` filter
// (GET /albums/:linkId/assets) and the merged photo timeline
// (GET /groups/:groupId/photos?personId=), so the cross-owner label-matching
// logic — the same real person can be a distinct provider-side person entity
// per Immich library owner, see MediaPersonLink's doc comments — lives in
// exactly one place instead of being duplicated per caller.
export async function resolvePersonFilterForAlbum(
  link: { provider: string; externalAlbumId: string },
  personId: string
): Promise<PersonFilterOutcome> {
  // Only a mapped person can be filtered on — this also stops a client from
  // probing arbitrary provider-side person ids that were never deliberately
  // exposed to families via the admin mapping UI.
  const personLink = await prisma.mediaPersonLink.findUnique({
    where: { provider_externalPersonId: { provider: link.provider, externalPersonId: personId } },
  });
  if (!personLink) return { ok: false, status: 404, errorKey: 'errors.mediaPersonLinkNotFound' };

  const provider = getMediaProvider(link.provider);
  if (!provider) return { ok: false, status: 404, errorKey: 'errors.mediaAlbumLinkNotFound' };

  if (!provider.getAlbumAssetPeople && !provider.getPersonAssetIds) {
    return { ok: false, status: 400, errorKey: 'errors.mediaProviderLacksPersonFilter' };
  }

  // Label-aware: filtering by one mapped id must also match every other
  // MediaPersonLink sharing this provider + label — e.g. "Emma" mapped
  // twice, once per parent's library, filters both at once.
  const sameLabelLinks = await prisma.mediaPersonLink.findMany({
    where: { provider: link.provider, label: personLink.label },
  });
  const wantedPersonIds = new Set(sameLabelLinks.map((p) => p.externalPersonId));

  try {
    if (provider.getAlbumAssetPeople) {
      // Asset-centric: works cross-owner, since it reads the `people` the
      // provider attaches to every asset the requester can see in this
      // shared album, rather than querying the key owner's own person index
      // (which getPersonAssetIds is scoped to).
      const albumPeople = await provider.getAlbumAssetPeople(link.externalAlbumId);
      const assetIds = new Set(
        [...albumPeople.entries()]
          .filter(([, people]) => people.some((p) => wantedPersonIds.has(p.id)))
          .map(([assetId]) => assetId)
      );
      return { ok: true, assetIds };
    }

    const sets = await Promise.all([...wantedPersonIds].map((id) => provider.getPersonAssetIds!(id)));
    return { ok: true, assetIds: new Set(sets.flatMap((s) => [...s])) };
  } catch (err) {
    if (err instanceof MediaProviderError) {
      return { ok: false, status: mediaErrorStatus(err), errorKey: mediaErrorKey(err) };
    }
    throw err;
  }
}
