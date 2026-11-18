import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { prisma } from '../db.js'
import { requireAdmin } from '../plugins/auth.js'
import { getT } from '../i18n/index.js'
import { getImmichSettings, sameDestination } from '../services/settings.js'
import { MediaProviderError } from '../services/media/registry.js'
import { createImmichAlbum, immichAlbumExists, testImmichMirrorKey } from '../services/media/immichMirror.js'
import {
  isMirrorRunning,
  MAX_MIRROR_ATTEMPTS,
  MIRROR_PROVIDER,
  resetMirrorFailures,
  startMediaMirrorRun,
} from '../services/mediaMirror.js'

// Admin side of the Famlin -> Immich upload mirror (issue #420). Registered
// from inside routes/admin.ts, so its authentication hook applies here too.
// There is no delete: pausing (enabled: false) is the off switch, and
// choosing another album makes the job take Famlin's photos out of the old
// one.

const IMMICH_ALBUM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const updateMediaMirrorBodySchema = z.object({
  enabled: z.boolean(),
  // Required when the family has no mirror yet; otherwise changes the album.
  album: z
    .discriminatedUnion('mode', [
      z.object({ mode: z.literal('create') }),
      z.object({
        mode: z.literal('existing'),
        externalAlbumId: z.string().regex(IMMICH_ALBUM_ID),
        albumName: z.string().min(1).max(200),
      }),
    ])
    .optional(),
  // Mirror content created at or after this moment; an earlier date is a
  // backfill. Omitted: "now" for a new mirror, unchanged otherwise.
  mirrorSince: z.coerce.date().optional(),
})

const testMirrorBodySchema = z.object({
  serverUrl: z.string().url(),
  apiKey: z.string().optional(),
})

const ERROR_KEYS: Partial<Record<MediaProviderError['code'], string>> = {
  not_configured: 'errors.mediaMirrorNotConfigured',
  album_not_found: 'errors.mediaMirrorAlbumNotFound',
  unauthorized: 'errors.mediaMirrorUnauthorized',
}

function sendMirrorError(err: unknown, request: FastifyRequest, reply: FastifyReply) {
  if (!(err instanceof MediaProviderError)) throw err
  return reply
    .status(ERROR_KEYS[err.code] ? 400 : 502)
    .send({ error: getT(request)(ERROR_KEYS[err.code] ?? 'errors.immichUnreachable'), code: err.code })
}

async function mirrorOverview(groupId: string) {
  const [target, settings] = await Promise.all([
    prisma.mediaMirrorTarget.findUnique({ where: { groupId } }),
    getImmichSettings('mirror'),
  ])
  const base = { configured: settings.configured, maxAttempts: MAX_MIRROR_ATTEMPTS }
  if (!target) return { ...base, target: null, counts: { mirrored: 0, failed: 0 }, failures: [] }
  const where = { provider: target.provider, externalAlbumId: target.externalAlbumId }
  const [mirrored, failed, failures] = await Promise.all([
    prisma.mediaMirror.count({ where: { ...where, status: 'mirrored' } }),
    prisma.mediaMirror.count({ where: { ...where, status: 'failed' } }),
    prisma.mediaMirror.findMany({
      where: { ...where, status: 'failed' },
      orderBy: { updatedAt: 'desc' },
      take: 20,
      select: { assetKey: true, attempts: true, lastError: true, updatedAt: true },
    }),
  ])
  return { ...base, target, counts: { mirrored, failed }, failures }
}

export default async function adminMediaMirrorRoutes(fastify: FastifyInstance) {
  fastify.get('/groups/:id/media-mirror', async (request, reply) => {
    if (requireAdmin(request, reply)) return
    const { id } = request.params as { id: string }
    const group = await prisma.group.findUnique({ where: { id }, select: { id: true } })
    if (!group) return reply.status(404).send({ error: getT(request)('errors.groupNotFound') })
    return mirrorOverview(id)
  })

  fastify.put('/groups/:id/media-mirror', async (request, reply) => {
    if (requireAdmin(request, reply)) return
    const t = getT(request)
    const { id } = request.params as { id: string }
    const body = updateMediaMirrorBodySchema.parse(request.body)
    const group = await prisma.group.findUnique({ where: { id }, select: { id: true, name: true } })
    if (!group) return reply.status(404).send({ error: t('errors.groupNotFound') })
    const existing = await prisma.mediaMirrorTarget.findUnique({ where: { groupId: id } })
    if (!existing && !body.album) return reply.status(400).send({ error: t('errors.mediaMirrorAlbumRequired') })

    let album: { externalAlbumId: string; albumName: string } | undefined
    try {
      if (!(await getImmichSettings('mirror')).configured) throw new MediaProviderError('immich', 'not_configured')
      if (body.album?.mode === 'create') {
        const created = await createImmichAlbum(`Famlin – ${group.name}`)
        album = { externalAlbumId: created.id, albumName: created.albumName }
      } else if (body.album?.mode === 'existing') {
        if (await isLinkedElsewhere(id, body.album.externalAlbumId)) {
          return reply.status(409).send({ error: t('errors.mediaMirrorAlbumLinkedElsewhere') })
        }
        // The write key must be able to see the album before it's saved.
        if (!(await immichAlbumExists(body.album.externalAlbumId))) {
          throw new MediaProviderError('immich', 'album_not_found')
        }
        album = { externalAlbumId: body.album.externalAlbumId, albumName: body.album.albumName }
      }
    } catch (err) {
      return sendMirrorError(err, request, reply)
    }

    await prisma.mediaMirrorTarget.upsert({
      where: { groupId: id },
      create: {
        groupId: id,
        provider: MIRROR_PROVIDER,
        externalAlbumId: album!.externalAlbumId,
        albumName: album!.albumName,
        enabled: body.enabled,
        mirrorSince: body.mirrorSince ?? new Date(),
      },
      update: {
        enabled: body.enabled,
        ...(album ?? {}),
        ...(body.mirrorSince ? { mirrorSince: body.mirrorSince } : {}),
      },
    })
    return mirrorOverview(id)
  })

  // "Sync now": gives failed uploads a fresh set of attempts and starts a
  // run in the background — unless one is running, which then picks the
  // reset attempts up on its next pass.
  fastify.post('/groups/:id/media-mirror/sync', async (request, reply) => {
    if (requireAdmin(request, reply)) return
    const { id } = request.params as { id: string }
    const target = await prisma.mediaMirrorTarget.findUnique({ where: { groupId: id } })
    if (!target) return reply.status(404).send({ error: getT(request)('errors.mediaMirrorNotFound') })
    await resetMirrorFailures(target.externalAlbumId)
    if (isMirrorRunning()) return reply.status(202).send({ started: false })
    startMediaMirrorRun().catch((err) => request.log.warn({ err }, 'media mirror sync failed'))
    return reply.status(202).send({ started: true })
  })

  // Checks the write key and reports missing scopes. Like /immich/test, the
  // saved key is only ever sent to the saved server.
  fastify.post('/immich/mirror-test', async (request, reply) => {
    if (requireAdmin(request, reply)) return
    const body = testMirrorBodySchema.parse(request.body)
    const saved = await getImmichSettings('mirror')
    const apiKey = body.apiKey || (sameDestination(body.serverUrl, saved.serverUrl) ? saved.apiKey : '')
    if (!apiKey) return { ok: false, error: 'unauthorized' }
    return testImmichMirrorKey(body.serverUrl, apiKey)
  })
}

// A mirror album must not be linked as a read album to another family: its
// members would browse this family's photos through it. Checked from both
// sides — here when choosing the mirror album, isMirroredElsewhere when
// linking an album (routes/admin.ts).
export async function isLinkedElsewhere(groupId: string, externalAlbumId: string): Promise<boolean> {
  const link = await prisma.mediaAlbumLink.findFirst({
    where: { provider: MIRROR_PROVIDER, externalAlbumId, groupId: { not: groupId } },
    select: { id: true },
  })
  return !!link
}

// True when another family mirrors into this album — linking it to `groupId`
// would let that family's photos be browsed here.
export async function isMirroredElsewhere(groupId: string, externalAlbumId: string): Promise<boolean> {
  const target = await prisma.mediaMirrorTarget.findFirst({
    where: { provider: MIRROR_PROVIDER, externalAlbumId, groupId: { not: groupId } },
    select: { id: true },
  })
  return !!target
}
