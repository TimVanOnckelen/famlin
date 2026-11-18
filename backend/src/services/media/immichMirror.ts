import { openAsBlob } from 'node:fs'
import { immichRequest, normalizeImmichUrl, requireImmichSettings, type ImmichCreds } from './immich.js'
import { MediaProviderError } from './types.js'

// The write side of the Immich integration, used only by the upload mirror
// (services/mediaMirror.ts, issue #420). It authenticates with the separate
// immichMirrorApiKey setting so the read key the MediaProvider uses
// (services/media/immich.ts) can stay read-only. Errors are
// MediaProviderErrors: `unreachable` = no answer at all, `request_failed` =
// Immich answered this request with an error, `album_not_found`.

// Every scope the mirror needs: uploading, reading an album's assets back,
// creating the album, and adding and removing album assets.
export const IMMICH_MIRROR_SCOPES = [
  'asset.upload',
  'asset.read',
  'album.create',
  'album.read',
  'albumAsset.create',
  'albumAsset.delete',
] as const

const mirrorCreds = () => requireImmichSettings('mirror')

async function expectOk(res: Response, what: string): Promise<Response> {
  if (res.ok) return res
  const detail = await res.text().catch(() => '')
  console.warn(`Immich mirror request failed: ${what} -> ${res.status} ${detail.slice(0, 300)}`)
  // The step and status reach the admin's failure list (never the body,
  // which may echo request details).
  const err = new MediaProviderError('immich', 'request_failed')
  err.message = `${err.message} (${what}: HTTP ${res.status})`
  throw err
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

// Takes explicit credentials so the admin UI can test a key before saving
// it. Reachability uses the public /server/ping, so a key scoped to just the
// mirror's permissions still passes. `missingScopes` is null when the server
// can't report the key's permissions (Immich without GET /api-keys/me); []
// means the key has everything the mirror needs.
export async function testImmichMirrorKey(
  serverUrl: string,
  apiKey: string
): Promise<{ ok: true; missingScopes: string[] | null } | { ok: false; error: 'unreachable' | 'unauthorized' }> {
  const creds: ImmichCreds = { serverUrl: normalizeImmichUrl(serverUrl), apiKey: apiKey.trim() }
  try {
    await expectOk(await immichRequest('/server/ping', creds), 'ping')
    const me = await immichRequest('/api-keys/me', creds)
    if (me.ok) {
      const { permissions } = (await me.json()) as { permissions?: unknown }
      if (!Array.isArray(permissions)) return { ok: true, missingScopes: null }
      const granted = new Set(permissions.map(String))
      if (granted.has('all')) return { ok: true, missingScopes: [] }
      return { ok: true, missingScopes: IMMICH_MIRROR_SCOPES.filter((scope) => !granted.has(scope)) }
    }
    // Older Immich: no key introspection. Any authenticated read proves the
    // key is accepted.
    await expectOk(await immichRequest('/albums', creds), 'albums')
    return { ok: true, missingScopes: null }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof MediaProviderError && err.code === 'unauthorized' ? 'unauthorized' : 'unreachable',
    }
  }
}

// Answers whether Immich is up at all, to tell "this file failed" from
// "Immich went away" when an upload loses its connection.
export async function pingImmich(): Promise<boolean> {
  try {
    return (await immichRequest('/server/ping', await mirrorCreds())).ok
  } catch {
    return false
  }
}

export async function createImmichAlbum(albumName: string): Promise<{ id: string; albumName: string }> {
  const res = await expectOk(
    await immichRequest('/albums', await mirrorCreds(), json('POST', { albumName })),
    'create album'
  )
  const data = (await res.json()) as { id: string; albumName: string }
  return { id: data.id, albumName: data.albumName }
}

// Immich answers an unknown (or inaccessible) album with 400 on some
// versions and 404 on others.
export async function immichAlbumExists(albumId: string): Promise<boolean> {
  const res = await immichRequest(`/albums/${albumId}?withoutAssets=true`, await mirrorCreds())
  if (res.status === 400 || res.status === 404) return false
  await expectOk(res, 'album')
  return true
}

// The album's asset ids as the mirror key's search sees them. Only a hint:
// Immich's search can leave out other owners' assets, so callers confirm an
// asset missing from it through addImmichAlbumAssets rather than trusting
// its absence.
export async function listImmichAlbumAssetIds(albumId: string): Promise<Set<string>> {
  if (!(await immichAlbumExists(albumId))) throw new MediaProviderError('immich', 'album_not_found')
  const creds = await mirrorCreds()
  const ids = new Set<string>()
  let page: number | null = 1
  // A family album is far below this; the cap only stops a runaway loop.
  for (let i = 0; i < 200 && page; i++) {
    const res = await expectOk(
      await immichRequest('/search/metadata', creds, json('POST', { albumIds: [albumId], size: 1000, page })),
      'search'
    )
    const data = (await res.json()) as { assets?: { items?: { id: string }[]; nextPage?: string | null } }
    const items = data.assets?.items ?? []
    for (const item of items) ids.add(item.id)
    page = items.length > 0 && data.assets?.nextPage ? Number(data.assets.nextPage) : null
  }
  return ids
}

export interface ImmichUploadInput {
  filePath: string
  filename: string
  // SHA-1 of the file, hex — Immich dedupes on it, so a re-upload (a retry,
  // a restore onto a server that already has the file) returns the
  // existing asset instead of storing a second copy.
  checksum: string
  deviceAssetId: string
  fileCreatedAt: Date
  livePhotoVideoId?: string
  // The video half of a Live Photo: stored, but not shown on the timeline
  // on its own.
  hidden?: boolean
}

export const IMMICH_MIRROR_DEVICE_ID = 'famlin'

// `created`: this upload stored a new asset (not a checksum duplicate).
export async function uploadImmichAsset(input: ImmichUploadInput): Promise<{ id: string; created: boolean }> {
  const form = new FormData()
  form.append('deviceAssetId', input.deviceAssetId)
  form.append('deviceId', IMMICH_MIRROR_DEVICE_ID)
  form.append('fileCreatedAt', input.fileCreatedAt.toISOString())
  form.append('fileModifiedAt', input.fileCreatedAt.toISOString())
  form.append('filename', input.filename)
  if (input.livePhotoVideoId) form.append('livePhotoVideoId', input.livePhotoVideoId)
  if (input.hidden) form.append('visibility', 'hidden')
  form.append('assetData', await openAsBlob(input.filePath), input.filename)
  const res = await expectOk(
    await immichRequest('/assets', await mirrorCreds(), {
      method: 'POST',
      headers: { 'x-immich-checksum': input.checksum },
      body: form,
    }),
    'upload'
  )
  const data = (await res.json()) as { id: string; status?: string }
  return { id: data.id, created: data.status !== 'duplicate' }
}

// Whether Famlin's own upload created this asset (its device ids), for an
// asset the album already held when Famlin went to add it. null = unknown
// asset.
export async function isFamlinImmichAsset(assetId: string, deviceAssetId: string): Promise<boolean | null> {
  const res = await immichRequest(`/assets/${assetId}`, await mirrorCreds())
  if (res.status === 400 || res.status === 404) return null
  const asset = (await (await expectOk(res, 'asset')).json()) as { deviceId?: string; deviceAssetId?: string }
  return asset.deviceId === IMMICH_MIRROR_DEVICE_ID && asset.deviceAssetId === deviceAssetId
}

// 'added': now in the album because of this call. 'present': already there.
// 'missing': Immich doesn't know the asset id.
export type AlbumAddResult = 'added' | 'present' | 'missing' | 'failed'

export async function addImmichAlbumAssets(albumId: string, assetIds: string[]): Promise<Map<string, AlbumAddResult>> {
  const result = new Map<string, AlbumAddResult>()
  if (assetIds.length === 0) return result
  const res = await expectOk(
    await immichRequest(`/albums/${albumId}/assets`, await mirrorCreds(), json('PUT', { ids: assetIds })),
    'album add'
  )
  for (const item of (await res.json()) as { id: string; success: boolean; error?: string }[]) {
    result.set(
      item.id,
      item.success
        ? 'added'
        : item.error === 'duplicate'
          ? 'present'
          : item.error === 'not_found'
            ? 'missing'
            : 'failed'
    )
  }
  return result
}

// Only ever called with assets Famlin added itself (MediaMirror.addedByFamlin).
// Removes them from the album; the assets themselves stay in Immich. An id
// that isn't in the album just gets a per-id error back, so this is safe to
// call without first confirming membership.
export async function removeImmichAlbumAssets(albumId: string, assetIds: string[]): Promise<void> {
  if (assetIds.length === 0) return
  await expectOk(
    await immichRequest(`/albums/${albumId}/assets`, await mirrorCreds(), json('DELETE', { ids: assetIds })),
    'album remove'
  )
}
