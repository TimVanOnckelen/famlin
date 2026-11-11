import fp from 'fastify-plugin'
import type { FastifyInstance } from 'fastify'
import { getT } from '../i18n/index.js'
import { requestPathname } from '../utils/requestPath.js'
import { isRestoreRunning } from '../services/backup/index.js'

export const RESTORE_IN_PROGRESS_CODE = 'RESTORE_IN_PROGRESS'

// Reachable while a restore runs: its own progress, and the health check.
const ALLOWED = new Set(['/api/auth/restore-status', '/health'])

/**
 * While a backup is being restored onto this running server (admin Backups
 * page, services/backup/restoreRunning.ts), every API request gets a 503: the database is being replaced, so a write would be lost or land in
 * a half-restored state, and a read could show either version.
 */
export default fp(async function restoreMaintenancePlugin(fastify: FastifyInstance) {
  fastify.addHook('onRequest', async (request, reply) => {
    if (!isRestoreRunning()) return
    const url = requestPathname(request.raw.url)
    if (ALLOWED.has(url)) return
    if (!url.startsWith('/api/')) return
    return reply
      .status(503)
      .header('retry-after', '30')
      .send({ error: getT(request)('errors.restoreInProgress'), code: RESTORE_IN_PROGRESS_CODE })
  })
})
