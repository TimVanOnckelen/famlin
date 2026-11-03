import { FastifyInstance } from 'fastify'
import { prisma } from '../db.js'
import { devicePathParamsSchema, devicePayloadSchema } from '../types.js'
import { DeviceLimitError, reportDevice } from '../services/devices.js'
import { getT } from '../i18n/index.js'

export default async function deviceRoutes(fastify: FastifyInstance) {
  fastify.get('/me', { preHandler: [fastify.authenticate] }, async (request) => {
    return prisma.device.findMany({
      where: { userId: request.user!.id },
      orderBy: { installId: 'asc' },
      select: {
        installId: true,
        platform: true,
        osVersion: true,
        appVersion: true,
        appBuild: true,
        pushPermission: true,
      },
    })
  })

  fastify.put('/:installId', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { installId } = devicePathParamsSchema.parse(request.params)
    const payload = devicePayloadSchema.parse(request.body)

    try {
      const { changed } = await reportDevice(request.user!.id, installId, payload)
      return { success: true, changed }
    } catch (error) {
      if (error instanceof DeviceLimitError) {
        return reply.status(409).send({ error: getT(request)('errors.deviceLimitReached') })
      }
      throw error
    }
  })

  fastify.delete('/:installId', { preHandler: [fastify.authenticate] }, async (request) => {
    const { installId } = devicePathParamsSchema.parse(request.params)
    await prisma.device.deleteMany({ where: { installId, userId: request.user!.id } })
    return { success: true }
  })
}
