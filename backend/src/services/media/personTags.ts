import { prisma } from '../../db.js';
import { parseMediaAssetPath } from '../../types.js';
import { getMediaProvider } from './registry.js';

// One admin-mapped person who appears in a post's photos — the enriched
// shape every post-returning member endpoint attaches as `post.people`.
export interface PersonTag {
  id: string; // MediaPersonLink.externalPersonId
  provider: string;
  label: string;
  userId: string | null;
  userName: string | null;
  userAvatarUrl: string | null;
}

interface PersonAssetIdCacheEntry {
  ids: Set<string>;
  expiresAt: number;
}

// Caches a person's full asset-id set (an Immich getPersonAssetIds() crawl
// is paginated and can take a second or two cold) so a feed page with many
// posts — or a client re-polling the feed — doesn't re-crawl the provider
// per request. Keyed `provider:externalPersonId` since ids are only unique
// within a provider (mirrors MediaAlbumLink's compound uniqueness).
const PERSON_ASSET_CACHE_TTL_MS = 10 * 60 * 1000;
const personAssetIdCache = new Map<string, PersonAssetIdCacheEntry>();

function cacheKey(provider: string, externalPersonId: string): string {
  return `${provider}:${externalPersonId}`;
}

// Resolves (and caches) one person's asset-id set. Fails soft: any provider
// error (Immich down, network blip, etc.) is logged and reported as "unknown"
// (null) rather than thrown, so one broken person/provider can never fail a
// feed request or drop tags for every *other* person on the post.
//
// Only used as the fallback path for providers that don't implement the
// asset-centric getAlbumAssetPeople() below (see attachPeopleToPosts) — a
// provider WITH that capability never calls this, since getPersonAssetIds()
// only sees people the API key's own account recognizes and would silently
// miss cross-owner shared-album people.
async function getCachedPersonAssetIds(provider: string, externalPersonId: string): Promise<Set<string> | null> {
  const key = cacheKey(provider, externalPersonId);
  const cached = personAssetIdCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.ids;

  const mediaProvider = getMediaProvider(provider);
  if (!mediaProvider?.getPersonAssetIds) return null;

  try {
    const ids = await mediaProvider.getPersonAssetIds(externalPersonId);
    personAssetIdCache.set(key, { ids, expiresAt: Date.now() + PERSON_ASSET_CACHE_TTL_MS });
    return ids;
  } catch (err) {
    console.warn(`personTags: failed to resolve assets for person ${key}:`, err);
    return null;
  }
}

interface AlbumPeopleCacheEntry {
  data: Map<string, Array<{ id: string; name: string }>>;
  expiresAt: number;
}

// Same idea as personAssetIdCache above, but for the asset-centric
// getAlbumAssetPeople() crawl — keyed `provider:externalAlbumId`. Providers
// that implement it (Immich) already cache internally too (see
// immich.ts's albumAssetPeopleCache), but this module can't rely on that:
// it's a MediaProvider contract detail, not a guarantee, and this cache also
// gives every provider fail-soft behavior (see below) for free.
const ALBUM_PEOPLE_CACHE_TTL_MS = 10 * 60 * 1000;
const albumPeopleCache = new Map<string, AlbumPeopleCacheEntry>();

// Resolves (and caches) one album's assetId -> people map. Fails soft, same
// contract as getCachedPersonAssetIds: a provider error never fails the
// request, it just means that album's posts get no asset-centric tags for
// this request (the fallback pass in attachPeopleToPosts is only used for
// providers that don't implement this capability at all, not for runtime
// failures of ones that do — mirrors how a getPersonAssetIds() throw already
// behaved before this).
async function getCachedAlbumAssetPeople(
  provider: string,
  externalAlbumId: string
): Promise<Map<string, Array<{ id: string; name: string }>> | null> {
  const key = cacheKey(provider, externalAlbumId);
  const cached = albumPeopleCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const mediaProvider = getMediaProvider(provider);
  if (!mediaProvider?.getAlbumAssetPeople) return null;

  try {
    const data = await mediaProvider.getAlbumAssetPeople(externalAlbumId);
    albumPeopleCache.set(key, { data, expiresAt: Date.now() + ALBUM_PEOPLE_CACHE_TTL_MS });
    return data;
  } catch (err) {
    console.warn(`personTags: failed to resolve album people for ${key}:`, err);
    return null;
  }
}

// Test-only escape hatch (mirrors __clearDomainEventHandlersForTests /
// __registerMediaProviderForTests) so one test's cached asset ids can't leak
// into another test file's assertions on call counts.
export function __clearPersonTagCacheForTests(): void {
  personAssetIdCache.clear();
  albumPeopleCache.clear();
}

interface PostAssetRef {
  linkId: string;
  assetId: string;
}

// Attaches the admin-mapped people who appear in each post's photos. Returns
// a postId -> PersonTag[] map (deduplicated, ordered by label) rather than
// mutating/returning the posts themselves, so callers can spread it onto
// whatever shape they're already building (shapePost's output, or
// favorites.ts's own inline shape) without this module knowing about either.
export async function attachPeopleToPosts<T extends { id: string; uploadedAssetUrls: string[] }>(
  posts: T[]
): Promise<Map<string, PersonTag[]>> {
  const tagsByPostId = new Map<string, PersonTag[]>();
  for (const post of posts) tagsByPostId.set(post.id, []);

  // Fast exit: zero-cost for the (default) deployment with no admin-mapped
  // people — one cheap count, no asset parsing, no provider calls.
  const personLinks = await prisma.mediaPersonLink.findMany();
  if (personLinks.length === 0) return tagsByPostId;

  // Parse every post's asset URLs, collecting per-post {linkId, assetId}
  // refs plus the full set of linkIds involved, so those links can be
  // resolved to their provider in one batched query.
  const postAssetRefs = new Map<string, PostAssetRef[]>();
  const linkIds = new Set<string>();
  for (const post of posts) {
    const refs: PostAssetRef[] = [];
    for (const url of post.uploadedAssetUrls) {
      const parsed = parseMediaAssetPath(url);
      if (!parsed) continue;
      refs.push({ linkId: parsed.linkId, assetId: parsed.assetId });
      linkIds.add(parsed.linkId);
    }
    if (refs.length > 0) postAssetRefs.set(post.id, refs);
  }
  if (linkIds.size === 0) return tagsByPostId;

  const links = await prisma.mediaAlbumLink.findMany({ where: { id: { in: [...linkIds] } } });
  const providerByLinkId = new Map(links.map((link) => [link.id, link.provider]));
  const albumIdByLinkId = new Map(links.map((link) => [link.id, link.externalAlbumId]));

  const userIds = [...new Set(personLinks.map((p) => p.userId).filter((id): id is string => !!id))];
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, avatarUrl: true } })
    : [];
  const userById = new Map(users.map((u) => [u.id, u]));

  const tagFor = (personLink: (typeof personLinks)[number]): PersonTag => {
    const user = personLink.userId ? userById.get(personLink.userId) : undefined;
    return {
      id: personLink.externalPersonId,
      provider: personLink.provider,
      label: personLink.label,
      userId: personLink.userId,
      userName: user?.name ?? null,
      userAvatarUrl: user?.avatarUrl ?? null,
    };
  };

  // O(1) lookup from an asset's tagged people (provider + their raw
  // provider-side id) back to the MediaPersonLink that maps them, for the
  // asset-centric pass below.
  const personLinkByProviderAndId = new Map(personLinks.map((p) => [cacheKey(p.provider, p.externalPersonId), p]));

  // `${postId}:${provider}:${externalPersonId}` -> already tagged, so the two
  // passes below (or two assets on the same post tagged with the same
  // person) can never double-add the same person to one post.
  const taggedKeys = new Set<string>();
  function addTag(postId: string, personLink: (typeof personLinks)[number]) {
    const key = `${postId}:${cacheKey(personLink.provider, personLink.externalPersonId)}`;
    if (taggedKeys.has(key)) return;
    taggedKeys.add(key);
    tagsByPostId.get(postId)!.push(tagFor(personLink));
  }

  // Group each post's asset refs by linkId, so the asset-centric pass below
  // can resolve one album's people map once and sweep every post that
  // references it, instead of re-scanning every post per link.
  const refsByLinkId = new Map<string, Array<{ postId: string; assetId: string }>>();
  for (const [postId, refs] of postAssetRefs) {
    for (const ref of refs) {
      const arr = refsByLinkId.get(ref.linkId);
      if (arr) arr.push({ postId, assetId: ref.assetId });
      else refsByLinkId.set(ref.linkId, [{ postId, assetId: ref.assetId }]);
    }
  }

  // Asset-centric pass: for every provider that can report an album's
  // assets' tagged people in bulk (getAlbumAssetPeople — see types.ts), tag a
  // post with every MAPPED person appearing on any of its assets. This is
  // what makes cross-owner shared-album people visible at all; the
  // person-centric fallback below can't see them.
  for (const linkId of linkIds) {
    const provider = providerByLinkId.get(linkId);
    const externalAlbumId = albumIdByLinkId.get(linkId);
    if (!provider || !externalAlbumId) continue;
    if (!getMediaProvider(provider)?.getAlbumAssetPeople) continue;

    const albumPeople = await getCachedAlbumAssetPeople(provider, externalAlbumId);
    if (!albumPeople) continue;

    for (const { postId, assetId } of refsByLinkId.get(linkId) ?? []) {
      const peopleOnAsset = albumPeople.get(assetId);
      if (!peopleOnAsset) continue;
      for (const person of peopleOnAsset) {
        const personLink = personLinkByProviderAndId.get(cacheKey(provider, person.id));
        if (personLink) addTag(postId, personLink);
      }
    }
  }

  // Person-centric fallback: only for providers that don't implement
  // getAlbumAssetPeople at all — a provider that does is handled entirely by
  // the pass above (a runtime failure there fails soft to "no tags for that
  // album this request", it does not fall through to a per-person crawl).
  for (const personLink of personLinks) {
    if (getMediaProvider(personLink.provider)?.getAlbumAssetPeople) continue;

    const assetIds = await getCachedPersonAssetIds(personLink.provider, personLink.externalPersonId);
    if (!assetIds) continue;

    for (const [postId, refs] of postAssetRefs) {
      const matches = refs.some(
        (ref) => providerByLinkId.get(ref.linkId) === personLink.provider && assetIds.has(ref.assetId)
      );
      if (matches) addTag(postId, personLink);
    }
  }

  // Dedupe by label: two provider-side person entities can map to the same
  // label — most commonly the cross-owner case this feature exists for (e.g.
  // "Emma" recognized separately in two family members' own Immich
  // libraries) — and must collapse to one chip. Prefer whichever entry has a
  // Famlin user attached, since that carries more information than an
  // unmapped one.
  for (const [postId, tags] of tagsByPostId) {
    const byLabel = new Map<string, PersonTag>();
    for (const tag of tags) {
      const existing = byLabel.get(tag.label);
      if (!existing || (!existing.userId && tag.userId)) byLabel.set(tag.label, tag);
    }
    const deduped = [...byLabel.values()].sort((a, b) => a.label.localeCompare(b.label));
    tagsByPostId.set(postId, deduped);
  }

  return tagsByPostId;
}
