import { openAsBlob } from 'node:fs'
import { getImmichMirrorSettings } from '../settings.js'

// The write side of the Immich integration, used only by the upload mirror
// (services/mediaMirror.ts, issue #420). It authenticates with the separate
// immichMirrorApiKey setting so the read key the MediaProvider uses
// (services/media/immich.ts) can stay read-only.

// 'unreachable' = no answer at all (Immich is down): the run stops and
// nothing is held against the upload. 'request_failed' = Immich answered
// with an error for this request: counted against that one upload.
export type ImmichMirrorErrorCode =
  'not_configured' | 'unreachable' | 'unauthorized' | 'album_not_found' | 'request_failed'

export class ImmichMirrorError extends Error {
  constructor(
    public code: ImmichMirrorErrorCode,
    detail?: string
  ) {
    super(detail ? `immich mirror: ${code} (${detail})` : `immich mirror: ${code}`)
    this.name = 'ImmichMirrorError'
  }
}

interface Creds {
  serverUrl: string
  apiKey: string
}

// Every scope the mirror needs: uploading, reading an album's assets back
// (to notice an asset Immich no longer has), creating the album, and adding
// and removing album assets.
export const IMMICH_MIRROR_SCOPES = [
  'asset.upload',
  'asset.read',
  'album.create',
  'album.read',
  'albumAsset.create',
  'albumAsset.delete',
] as const

async function requireCreds(): Promise<Creds> {
  const { serverUrl, apiKey, configured } = await getImmichMirrorSettings()
  if (!configured) throw new ImmichMirrorError('not_configured')
  return { serverUrl, apiKey }
}

async function call(
  path: string,
  creds: Creds,
  init: RequestInit & { allowMissing?: boolean } = {}
): Promise<Response> {
  let res: Response
  try {
    res = await fetch(`${creds.serverUrl}/api${path}`, {
      ...init,
      headers: { 'x-api-key': creds.apiKey, Accept: 'application/json', ...(init.headers as Record<string, string>) },
    })
  } catch {
    throw new ImmichMirrorError('unreachable')
  }
  if (res.status === 401 || res.status === 403) throw new ImmichMirrorError('unauthorized')
  // Immich answers an unknown (or inaccessible) album id with 400 rather
  // than 404 on some versions.
  if (init.allowMissing && (res.status === 404 || res.status === 400)) return res
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    console.warn(
      `Immich mirror request failed: ${init.method ?? 'GET'} ${path} -> ${res.status} ${detail.slice(0, 300)}`
    )
    throw new ImmichMirrorError('request_failed', `HTTP ${res.status}`)
  }
  return res
}

const json = (body: unknown): RequestInit => ({
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

// Takes explicit credentials so the admin UI can test a key before saving
// it. `missingScopes` is null when the server can't report the key's
// permissions (Immich versions without GET /api-keys/me); [] means the key
// has everything the mirror needs.
export async function testImmichMirrorKey(
  serverUrl: string,
  apiKey: string
): Promise<{ ok: true; missingScopes: string[] | null } | { ok: false; error: 'unreachable' | 'unauthorized' }> {
  const creds = { serverUrl: serverUrl.trim().replace(/\/$/, ''), apiKey: apiKey.trim() }
  try {
    await call('/server/about', creds)
    const res = await call('/api-keys/me', creds, { allowMissing: true })
    if (!res.ok) return { ok: true, missingScopes: null }
    const data = (await res.json()) as { permissions?: unknown }
    if (!Array.isArray(data.permissions)) return { ok: true, missingScopes: null }
    const granted = new Set(data.permissions.map(String))
    if (granted.has('all')) return { ok: true, missingScopes: [] }
    return { ok: true, missingScopes: IMMICH_MIRROR_SCOPES.filter((scope) => !granted.has(scope)) }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof ImmichMirrorError && err.code === 'unauthorized' ? 'unauthorized' : 'unreachable',
    }
  }
}

export async function createImmichAlbum(albumName: string): Promise<{ id: string; albumName: string }> {
  const creds = await requireCreds()
  const res = await call('/albums', creds, { method: 'POST', ...json({ albumName }) })
  const data = (await res.json()) as { id: string; albumName: string }
  return { id: data.id, albumName: data.albumName }
}

// Every asset id in the album, following search pagination. Throws
// album_not_found when the album was deleted on the Immich side (or the
// mirror key can't see it).
export async function listImmichAlbumAssetIds(albumId: string): Promise<Set<string>> {
  const creds = await requireCreds()
  const album = await call(`/albums/${albumId}?withoutAssets=true`, creds, { allowMissing: true })
  if (!album.ok) throw new ImmichMirrorError('album_not_found')

  const ids = new Set<string>()
  let page: number | string | undefined = 1
  // A family album is far below this; the cap only stops a runaway loop.
  for (let i = 0; i < 200 && page; i++) {
    const res = await call('/search/metadata', creds, {
      method: 'POST',
      ...json({ albumIds: [albumId], size: 1000, page: Number(page) }),
    })
    const data = (await res.json()) as { assets?: { items?: { id: string }[]; nextPage?: string | null } }
    const items = data.assets?.items ?? []
    for (const item of items) ids.add(item.id)
    page = items.length > 0 ? (data.assets?.nextPage ?? undefined) : undefined
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
  // Stable per upload, so Immich's per-device dedupe agrees with ours.
  deviceAssetId: string
  fileCreatedAt: Date
  livePhotoVideoId?: string
  // The video half of a Live Photo: stored, but not shown on the timeline
  // on its own.
  hidden?: boolean
}

export async function uploadImmichAsset(input: ImmichUploadInput): Promise<{ id: string; duplicate: boolean }> {
  const creds = await requireCreds()
  const form = new FormData()
  form.append('deviceAssetId', input.deviceAssetId)
  form.append('deviceId', 'famlin')
  form.append('fileCreatedAt', input.fileCreatedAt.toISOString())
  form.append('fileModifiedAt', input.fileCreatedAt.toISOString())
  form.append('filename', input.filename)
  if (input.livePhotoVideoId) form.append('livePhotoVideoId', input.livePhotoVideoId)
  if (input.hidden) form.append('visibility', 'hidden')
  form.append('assetData', await openAsBlob(input.filePath), input.filename)
  const res = await call('/assets', creds, {
    method: 'POST',
    headers: { 'x-immich-checksum': input.checksum },
    body: form,
  })
  const data = (await res.json()) as { id: string; status?: string }
  return { id: data.id, duplicate: data.status === 'duplicate' }
}

// 'added': Famlin put it there. 'present': the album already held it.
export type AlbumAddResult = 'added' | 'present' | 'missing' | 'failed'

export async function addImmichAlbumAssets(albumId: string, assetIds: string[]): Promise<Map<string, AlbumAddResult>> {
  const creds = await requireCreds()
  const res = await call(`/albums/${albumId}/assets`, creds, {
    method: 'PUT',
    allowMissing: true,
    ...json({ ids: assetIds }),
  })
  if (!res.ok) throw new ImmichMirrorError('album_not_found')
  const data = (await res.json()) as { id: string; success: boolean; error?: string }[]
  const result = new Map<string, AlbumAddResult>()
  for (const item of data) {
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
// Removes them from the album; the assets themselves stay in Immich.
export async function removeImmichAlbumAssets(albumId: string, assetIds: string[]): Promise<void> {
  if (assetIds.length === 0) return
  const creds = await requireCreds()
  const res = await call(`/albums/${albumId}/assets`, creds, {
    method: 'DELETE',
    allowMissing: true,
    ...json({ ids: assetIds }),
  })
  if (!res.ok) throw new ImmichMirrorError('album_not_found')
}
