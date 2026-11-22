import type { FastifyInstance, FastifyRequest } from 'fastify'
import { getT } from '../i18n/index.js'
import { getAllSettings } from '../services/settings.js'
import { buildCalendarFeed, hashCalendarFeedToken, resolveCalendarFeedToken } from '../services/calendarFeed.js'
import { getPublicOrigin } from '../utils/publicOrigin.js'

// Calendar apps poll a subscription on their own schedule (typically every
// 5 minutes to a few hours), possibly from several devices sharing one URL.
// The budget is per token — never per IP, since Google/Apple/Outlook fetch
// on the subscriber's behalf from shared addresses — and keyed on a hash so
// the secret never ends up as a rate-limit store key.
const FEED_RATE_LIMIT = { max: 120, timeWindow: '1 hour' }

// The per-token budget replaces the global per-IP limit on this route, and
// on its own would let one client spray guessed tokens (each its own bucket)
// without bound — so the app-wide per-IP ceiling (app.ts) is checked here
// too. It can't be a second `rateLimit()` hook: the plugin runs only one
// limiter per request, so this uses `createRateLimit()` and answers itself.
const PER_IP_RATE_LIMIT = { max: 300, timeWindow: '1 minute' }

function tokenParam(request: FastifyRequest): string {
  return (request.params as { token?: string } | undefined)?.token ?? ''
}

// The member's personal iCal feed of family events (issue #499). Public — the
// token in the path is the credential, since calendar apps can't send an
// Authorization header — and read-only. Never logged: app.ts's request
// serializer redacts the token segment (utils/logRedaction.ts).
export default async function calendarRoutes(fastify: FastifyInstance) {
  const checkPerIpLimit = fastify.createRateLimit(PER_IP_RATE_LIMIT)

  fastify.get(
    '/:token/famlin.ics',
    {
      onRequest: async (request, reply) => {
        const limit = await checkPerIpLimit(request)
        if (limit.isAllowed || !limit.isExceeded) return
        reply.header('retry-after', limit.ttlInSeconds)
        throw Object.assign(new Error(`Rate limit exceeded, retry in ${limit.ttlInSeconds} seconds`), {
          statusCode: 429,
        })
      },
      config: {
        rateLimit: {
          ...FEED_RATE_LIMIT,
          keyGenerator: (request) => `calendar-feed:${hashCalendarFeedToken(tokenParam(request))}`,
        },
      },
    },
    async (request, reply) => {
      const userId = await resolveCalendarFeedToken(tokenParam(request))
      if (!userId) {
        return reply.status(404).send({ error: getT(request)('errors.notFound') })
      }

      const { publicUrl } = await getAllSettings()
      const body = await buildCalendarFeed(userId, {
        origin: publicUrl || getPublicOrigin(request),
        hasPublicUrl: !!publicUrl,
      })

      return reply
        .header('content-type', 'text/calendar; charset=utf-8')
        .header('content-disposition', 'inline; filename="famlin.ics"')
        .header('cache-control', 'private, max-age=300')
        .header('x-robots-tag', 'noindex')
        .send(body)
    }
  )
}
