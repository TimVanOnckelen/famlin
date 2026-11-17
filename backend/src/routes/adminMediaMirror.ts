import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { prisma } from '../db.js'
import { requireAdmin } from '../plugins/auth.js'
import { getT } from '../i18n/index.js'
import { getImmichMirrorSettings } from '../services/settings.js'
import { recordJobRun } from '../services/jobRuns.js'
import {
  createImmichAlbum,
  ImmichMirrorError,
  listImmichAlbumAssetIds,
  testImmichMirrorKey,
} from '../services/media/immichMirror.js'
import {
  MAX_MIRROR_ATTEMPTS,
  MIRROR_PROVIDER,
  resetMirrorFailures,
  runMediaMirrorJob,
} from '../services/mediaMirror.js'

// Admin side of the Famlin -> Immich upload mirror (issue #420). Registered
// from inside routes/admin.ts, so its authentication hook applies here too.

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

function sendMirrorError(err: unknown, request: FastifyRequest, reply: FastifyReply) {
  if (!(err instanceof ImmichMirrorError)) throw err
  const t = getT(request)
  const key =
    err.code === 'not_configured'
      ? 'errors.mediaMirrorNotConfigured'
      : err.code === 'album_not_found'
        ? 'errors.mediaMirrorAlbumNotFound'
        : err.code === 'unauthorized'
          ? 'errors.mediaMirrorUnauthorized'
          : 'errors.immichUnreachable'
  return reply.status(err.code === 'unreachable' || err.code === 'request_failed' ? 502 : 400).send({
    error: t(key),
    code: err.code,
  })
}

async function mirrorOverview(groupId: string) {
  const [target, settings] = await Promise.all([
    prisma.mediaMirrorTarget.findUnique({ where: { groupId } }),
    getImmichMirrorSettings(),
  ])
  const base = { configured: settings.configured, maxAttempts: MAX_MIRROR_ATTEMPTS }
  if (!target) return { ...base, target: null, counts: { mirrored: 0, pending: 0, failed: 0 }, failures: [] }
  const where = { provider: target.provider, externalAlbumId: target.externalAlbumId }
  const [grouped, failures] = await Promise.all([
    prisma.mediaMirror.groupBy({ by: ['status'], where, _count: { _all: true } }),
    prisma.mediaMirror.findMany({
      where: { ...where, status: 'failed' },
      orderBy: { updatedAt: 'desc' },
      take: 20,
      select: { assetKey: true, attempts: true, lastError: true, updatedAt: true },
    }),
  ])
  const count = (status: string) => grouped.find((g) => g.status === status)?._count._all ?? 0
  return {
    ...base,
    target,
    counts: { mirrored: count('mirrored'), pending: count('pending'), failed: count('failed') },
    failures,
  }
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
      if (body.album?.mode === 'create') {
        const created = await createImmichAlbum(`Famlin – ${group.name}`)
        album = { externalAlbumId: created.id, albumName: created.albumName }
      } else if (body.album?.mode === 'existing') {
        // Proves the write key can see (and so add to) the album before
        // anything is saved.
        await listImmichAlbumAssetIds(body.album.externalAlbumId)
        album = { externalAlbumId: body.album.externalAlbumId, albumName: body.album.albumName }
      } else if (body.enabled) {
        // Re-enabling needs a working key, or the first run just fails.
        const { configured } = await getImmichMirrorSettings()
        if (!configured) throw new ImmichMirrorError('not_configured')
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

  // Stops mirroring and forgets the family's album choice. The album keeps
  // what it holds, and the per-upload rows stay, so choosing the same album
  // again later picks up where it left off.
  fastify.delete('/groups/:id/media-mirror', async (request, reply) => {
    if (requireAdmin(request, reply)) return
    const { id } = request.params as { id: string }
    await prisma.mediaMirrorTarget.deleteMany({ where: { groupId: id } })
    return mirrorOverview(id)
  })

  // "Sync now": gives failed uploads a fresh set of attempts and starts a
  // run in the background (the job is single-flight, so a run already in
  // progress just finishes on its own).
  fastify.post('/groups/:id/media-mirror/sync', async (request, reply) => {
    if (requireAdmin(request, reply)) return
    const { id } = request.params as { id: string }
    const target = await prisma.mediaMirrorTarget.findUnique({ where: { groupId: id } })
    if (!target) return reply.status(404).send({ error: getT(request)('errors.mediaMirrorNotFound') })
    await resetMirrorFailures(target.provider, target.externalAlbumId)
    recordJobRun(
      'mediaMirror',
      () => runMediaMirrorJob(),
      (result) => ({ ...result })
    ).catch((err) => request.log.warn({ err }, 'media mirror sync failed'))
    return reply.status(202).send({ started: true })
  })

  // Checks the write key and reports missing scopes. Like /immich/test, the
  // saved key is only ever sent to the saved server.
  fastify.post('/immich/mirror-test', async (request, reply) => {
    if (requireAdmin(request, reply)) return
    const body = testMirrorBodySchema.parse(request.body)
    const saved = await getImmichMirrorSettings()
    const sameServer = body.serverUrl.trim().replace(/\/+$/, '') === saved.serverUrl
    const apiKey = body.apiKey || (sameServer ? saved.apiKey : '')
    if (!apiKey) return { ok: false, error: 'unauthorized' }
    return testImmichMirrorKey(body.serverUrl, apiKey)
  })
}
