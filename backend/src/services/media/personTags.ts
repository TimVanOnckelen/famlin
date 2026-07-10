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

// Test-only escape hatch (mirrors __clearDomainEventHandlersForTests /
// __registerMediaProviderForTests) so one test's cached asset ids can't leak
// into another test file's assertions on call counts.
export function __clearPersonTagCacheForTests(): void {
  personAssetIdCache.clear();
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

  const userIds = [...new Set(personLinks.map((p) => p.userId).filter((id): id is string => !!id))];
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, avatarUrl: true } })
    : [];
  const userById = new Map(users.map((u) => [u.id, u]));

  // Per mapped person: resolve their (cached) asset-id set, then tag every
  // post that references one of those ids through a link on that same
  // provider. Each person is independent — a throw/null from one never stops
  // the loop for the rest.
  for (const personLink of personLinks) {
    const assetIds = await getCachedPersonAssetIds(personLink.provider, personLink.externalPersonId);
    if (!assetIds) continue;

    const user = personLink.userId ? userById.get(personLink.userId) : undefined;
    const tag: PersonTag = {
      id: personLink.externalPersonId,
      provider: personLink.provider,
      label: personLink.label,
      userId: personLink.userId,
      userName: user?.name ?? null,
      userAvatarUrl: user?.avatarUrl ?? null,
    };

    for (const [postId, refs] of postAssetRefs) {
      const matches = refs.some(
        (ref) => providerByLinkId.get(ref.linkId) === personLink.provider && assetIds.has(ref.assetId)
      );
      if (matches) tagsByPostId.get(postId)!.push(tag);
    }
  }

  for (const tags of tagsByPostId.values()) {
    tags.sort((a, b) => a.label.localeCompare(b.label));
  }

  return tagsByPostId;
}
