import { prisma } from '../../db.js'
import { getImmichSettings } from '../settings.js'
import { MIRROR_PROVIDER } from '../mediaMirror.js'
import {
  fetchAlbumAssetPeople,
  fetchPersonThumbnailDataUri,
  normalizeImmichUrl,
  type ImmichCreds,
  type ImmichPersonRef,
} from './immich.js'
import type { MediaPersonSummary } from './types.js'

// Face data for Famlin's own uploads, read back from the Immich upload
// mirror (services/mediaMirror.ts). A directly uploaded photo has no face
// data in Famlin, but once the mirror has put it in a family's Immich album,
// Immich's face recognition tags it like any other asset. MediaMirror maps
// each upload (assetKey, the upload's UUID) to its Immich asset id, which is
// all it takes to reuse the admin's MediaPersonLink mappings for it.
//
// Read with the mirror key, not the read key: the mirror account owns these
// assets, and Immich only reports people on assets the caller owns (or can
// see through a shared album). Person ids are Immich person ids on the same
// server, so mappings use the ordinary provider id 'immich'; a mirror
// account that isn't the read account sees its own person entities, which
// the label matching in personTags/personFilter already merges.
//
// Everything here fails soft — Immich down, a key without person access, a
// deleted album — to "no people", never to a failed request.

const MIRROR_ALBUM_PEOPLE_TTL_MS = 10 * 60 * 1000
const mirrorAlbumPeopleCache = new Map<string, { data: Map<string, ImmichPersonRef[]>; expiresAt: number }>()

export function __clearMirrorPeopleCacheForTests(): void {
  mirrorAlbumPeopleCache.clear()
}

async function mirrorCreds(): Promise<ImmichCreds | null> {
  const { serverUrl, apiKey, configured } = await getImmichSettings('mirror')
  return configured ? { serverUrl: normalizeImmichUrl(serverUrl), apiKey } : null
}

// Cheap gate (settings are cached) so callers can skip gathering upload
// keys on a deployment without the mirror key.
export async function mirrorPeopleAvailable(): Promise<boolean> {
  return (await mirrorCreds()) !== null
}

async function mirrorAlbumPeople(albumId: string, creds: ImmichCreds): Promise<Map<string, ImmichPersonRef[]> | null> {
  const cached = mirrorAlbumPeopleCache.get(albumId)
  if (cached && cached.expiresAt > Date.now()) return cached.data
  try {
    const data = await fetchAlbumAssetPeople(albumId, creds)
    mirrorAlbumPeopleCache.set(albumId, { data, expiresAt: Date.now() + MIRROR_ALBUM_PEOPLE_TTL_MS })
    return data
  } catch (err) {
    console.warn(`mirrorPeople: failed to read people for mirror album ${albumId}:`, err)
    return null
  }
}

// uploadKey -> the Immich people on its mirrored copy. Uploads that aren't
// mirrored (yet), or whose album couldn't be read, are simply absent. One
// upload mirrored into several families' albums is the same Immich asset
// when the albums share an owner, but the people are merged by id anyway.
export async function mirroredUploadPeople(uploadKeys: Iterable<string>): Promise<Map<string, ImmichPersonRef[]>> {
  const result = new Map<string, ImmichPersonRef[]>()
  const keys = [...new Set(uploadKeys)]
  if (keys.length === 0) return result
  const creds = await mirrorCreds()
  if (!creds) return result

  const rows = await prisma.mediaMirror.findMany({
    where: { provider: MIRROR_PROVIDER, assetKey: { in: keys }, status: 'mirrored', externalAssetId: { not: null } },
    select: { assetKey: true, externalAlbumId: true, externalAssetId: true },
  })
  if (rows.length === 0) return result

  const albumIds = [...new Set(rows.map((row) => row.externalAlbumId))]
  const peopleByAlbum = new Map(
    await Promise.all(albumIds.map(async (id) => [id, await mirrorAlbumPeople(id, creds)] as const))
  )

  for (const row of rows) {
    const people = peopleByAlbum.get(row.externalAlbumId)?.get(row.externalAssetId!)
    if (!people?.length) continue
    const merged = new Map((result.get(row.assetKey) ?? []).map((p) => [p.id, p]))
    for (const person of people) if (!merged.has(person.id)) merged.set(person.id, person)
    result.set(row.assetKey, [...merged.values()])
  }
  return result
}

// The subset of `uploadKeys` whose mirrored copy shows `personId` — or any
// other Immich person mapped under the same label (the same family member
// recognized separately in two Immich libraries). Only a mapped person
// matches, like the album filter in personFilter.ts.
export async function mirroredUploadKeysWithPerson(
  uploadKeys: Iterable<string>,
  personId: string
): Promise<Set<string>> {
  const matches = new Set<string>()
  const personLink = await prisma.mediaPersonLink.findUnique({
    where: { provider_externalPersonId: { provider: MIRROR_PROVIDER, externalPersonId: personId } },
  })
  if (!personLink) return matches
  const sameLabel = await prisma.mediaPersonLink.findMany({
    where: { provider: MIRROR_PROVIDER, label: personLink.label },
    select: { externalPersonId: true },
  })
  const wanted = new Set(sameLabel.map((p) => p.externalPersonId))

  for (const [key, people] of await mirroredUploadPeople(uploadKeys)) {
    if (people.some((p) => wanted.has(p.id))) matches.add(key)
  }
  return matches
}

// Everyone Immich recognized in the families' mirror albums, for the admin's
// "map a person" picker (GET /api/admin/media/immich/people). Skips ids the
// caller already has and stops at `limit`; thumbnails come through the
// mirror key, since the read key may not see the mirror account's people.
export async function mirrorAlbumPeopleCatalog(knownIds: Set<string>, limit: number): Promise<MediaPersonSummary[]> {
  const found: MediaPersonSummary[] = []
  if (limit <= 0) return found
  const creds = await mirrorCreds()
  if (!creds) return found

  const targets = await prisma.mediaMirrorTarget.findMany({
    where: { provider: MIRROR_PROVIDER },
    select: { externalAlbumId: true },
  })
  const seen = new Set(knownIds)
  for (const albumId of new Set(targets.map((t) => t.externalAlbumId))) {
    const albumPeople = await mirrorAlbumPeople(albumId, creds)
    if (!albumPeople) continue
    for (const people of albumPeople.values()) {
      for (const person of people) {
        if (seen.has(person.id)) continue
        if (found.length >= limit) return found
        seen.add(person.id)
        found.push({
          id: person.id,
          name: person.name,
          thumbnailDataUri: await fetchPersonThumbnailDataUri(person.id, creds),
        })
      }
    }
  }
  return found
}
