import { FastifyInstance } from 'fastify'
import { Prisma } from '@prisma/client'
import { prisma } from '../db.js'
import { diagnosticReportBodySchema } from '../types.js'

// Member-facing half of the diagnostic reports (issue #357): the mobile app
// sends one only when the member taps "Send to server admin" after recording
// a feed scroll (Profile → Advanced). It is stored for this server's admins
// (GET /api/admin/diagnostics) and never forwarded anywhere.
export default async function diagnosticsRoutes(fastify: FastifyInstance) {
  fastify.post(
    '/reports',
    {
      preHandler: [fastify.authenticate],
      // Per user, not per IP (family members share a home connection), so it
      // runs as a preHandler after authenticate — same as GET /auth/me/export.
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 hour',
          hook: 'preHandler',
          keyGenerator: (request) => `diagnostic-report:${request.user?.id ?? request.ip}`,
        },
      },
    },
    async (request, reply) => {
      const body = diagnosticReportBodySchema.parse(request.body)
      const report = await prisma.diagnosticReport.create({
        data: {
          userId: request.user!.id,
          kind: body.kind,
          platform: body.platform,
          appVersion: body.appVersion,
          text: body.text,
          data: body.data as Prisma.InputJsonValue,
        },
        select: { id: true, createdAt: true },
      })
      return reply.status(201).send(report)
    }
  )
}
