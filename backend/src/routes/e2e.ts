import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { Prisma } from '@prisma/client'
import { prisma } from '../db.js'
import { getT } from '../i18n/index.js'
import {
  createE2eIdentityBodySchema,
  e2eTransferParamsSchema,
  putE2eTransferBodySchema,
  updateE2eRecoveryBodySchema,
} from '../types.js'
import { usersShareFamily } from '../services/chatConversations.js'
import { putTransfer, takeTransfer } from '../services/e2eTransfers.js'
import { isUniqueConstraintViolation } from '../utils/prismaErrors.js'

// End-to-end encrypted direct messages (issue #506): key directory + the QR
// transfer relay. The server stores PUBLIC keys and ciphertext only.

// Returns true (after sending a 403) unless the caller is a signed-in session.
function requireSession(request: FastifyRequest, reply: FastifyReply): boolean {
  if (request.authMethod !== 'session') {
    reply.status(403).send({ error: getT(request)('errors.sessionRequired') })
    return true
  }
  return false
}

const publicIdentity = (row: { version: number; signPublicKey: string; boxPublicKey: string; createdAt: Date }) => ({
  version: row.version,
  signPublicKey: row.signPublicKey,
  boxPublicKey: row.boxPublicKey,
  createdAt: row.createdAt,
})

export default async function e2eRoutes(fastify: FastifyInstance) {
  fastify.get('/identity/me', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    // The only response carrying recoveryBackup, so session-only.
    if (requireSession(request, reply)) return
    const rows = await prisma.e2eIdentity.findMany({
      where: { userId: request.user!.id },
      orderBy: { version: 'desc' },
    })
    return { identities: rows.map((row) => ({ ...publicIdentity(row), recoveryBackup: row.recoveryBackup })) }
  })

  fastify.post('/identity', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    if (requireSession(request, reply)) return
    const t = getT(request)
    const body = createE2eIdentityBodySchema.parse(request.body)
    const userId = request.user!.id
    const latest = await prisma.e2eIdentity.findFirst({
      where: { userId },
      orderBy: { version: 'desc' },
      select: { version: true },
    })
    if (body.version !== (latest?.version ?? 0) + 1) {
      return reply.status(409).send({ error: t('errors.e2eIdentityVersionConflict') })
    }
    try {
      const created = await prisma.e2eIdentity.create({
        data: {
          userId,
          version: body.version,
          signPublicKey: body.signPublicKey,
          boxPublicKey: body.boxPublicKey,
          recoveryBackup: body.recoveryBackup ?? Prisma.DbNull,
        },
      })
      return reply.status(201).send(publicIdentity(created))
    } catch (error) {
      // A concurrent request created the same version first.
      if (isUniqueConstraintViolation(error)) {
        return reply.status(409).send({ error: t('errors.e2eIdentityVersionConflict') })
      }
      throw error
    }
  })

  fastify.put('/identity/:version/recovery', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    if (requireSession(request, reply)) return
    const t = getT(request)
    const { version } = request.params as { version: string }
    const body = updateE2eRecoveryBodySchema.parse(request.body)
    const userId = request.user!.id
    const latest = await prisma.e2eIdentity.findFirst({
      where: { userId },
      orderBy: { version: 'desc' },
    })
    if (!latest || String(latest.version) !== version) {
      return reply.status(409).send({ error: t('errors.e2eIdentityVersionConflict') })
    }
    const updated = await prisma.e2eIdentity.update({
      where: { id: latest.id },
      data: { recoveryBackup: body.recoveryBackup ?? Prisma.DbNull },
    })
    return { ...publicIdentity(updated), recoveryBackup: updated.recoveryBackup }
  })

  fastify.get('/identity/:userId', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const t = getT(request)
    const { userId } = request.params as { userId: string }
    const viewerId = request.user!.id
    // 404, not 403: don't reveal which accounts exist to non-family.
    if (userId !== viewerId && !(await usersShareFamily(viewerId, userId))) {
      return reply.status(404).send({ error: t('errors.notFound') })
    }
    const rows = await prisma.e2eIdentity.findMany({ where: { userId }, orderBy: { version: 'desc' } })
    return { userId, identities: rows.map(publicIdentity) }
  })

  fastify.put('/transfers/:sessionId', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    if (requireSession(request, reply)) return
    const t = getT(request)
    const { sessionId } = e2eTransferParamsSchema.parse(request.params)
    const body = putE2eTransferBodySchema.parse(request.body)
    const result = putTransfer(sessionId, request.user!.id, body.payload)
    if (result === 'exists') return reply.status(409).send({ error: t('errors.e2eTransferExists') })
    if (result === 'full') return reply.status(429).send({ error: t('errors.e2eTransferExists') })
    return { success: true }
  })

  fastify.get('/transfers/:sessionId', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    if (requireSession(request, reply)) return
    const { sessionId } = e2eTransferParamsSchema.parse(request.params)
    const payload = takeTransfer(sessionId, request.user!.id)
    if (!payload) return reply.status(404).send({ error: getT(request)('errors.e2eTransferNotFound') })
    return { payload }
  })
}
