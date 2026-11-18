import fs from 'fs'
import fsp from 'fs/promises'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireAdmin, requireAdminSession } from '../plugins/auth.js'
import { getT } from '../i18n/index.js'
import { getAllSettings } from '../services/settings.js'
import { backupKeyInputSchema } from '../types.js'
import { listBackups, removeBackupArchive } from '../services/backup/archive.js'
import {
  backupKeyForKit,
  emergencyKitText,
  generateBackupKey,
  getBackupEncryptionStatus,
  setBackupEncryptionEnabled,
} from '../services/backup/encryption.js'
import { BACKUP_ARCHIVE_DIR, BACKUP_DB_DIR } from '../services/backup/paths.js'
import { isBackupRunning, isRestoreRunning } from '../services/backup/index.js'
import {
  backupFileKind,
  backupFilePath,
  getRestoreStatus,
  RunningRestoreError,
  startRunningRestore,
} from '../services/backup/restoreRunning.js'

// The admin Backups page (issue #461): every backup in the backups volume,
// download, delete, and restore onto this running server. Registered from
// inside routes/admin.ts, so its authentication hook (session, admin token,
// or a one-time ?downloadToken= on routes that opt in) applies here too.

const fileParams = z.object({ file: z.string().min(1).max(200) })
const restoreBody = z.object({ confirm: z.string().max(200), key: backupKeyInputSchema.optional() })

// What the admin types to confirm a restore: the family's name, or "Famlin"
// for an unbranded server.
export async function restoreConfirmName(): Promise<string> {
  const { brandName } = await getAllSettings()
  return brandName.trim() || 'Famlin'
}

// kitSaved: turning on, the admin confirms the emergency kit is stored elsewhere.
const encryptionBody = z.object({ enabled: z.boolean(), kitSaved: z.boolean().optional() })
const kitQuery = z.object({ key: z.string().max(200).optional() })

export default async function adminBackupRoutes(fastify: FastifyInstance) {
  fastify.get('/backups', async (request, reply) => {
    if (requireAdmin(request, reply)) return
    const [backups, confirmName, encryption] = await Promise.all([
      listBackups(BACKUP_ARCHIVE_DIR, BACKUP_DB_DIR),
      restoreConfirmName(),
      getBackupEncryptionStatus(),
    ])
    return { backups, backupRunning: isBackupRunning(), restore: getRestoreStatus(), confirmName, encryption }
  })

  // Backup encryption (issue #495): signed-in admins only, since the
  // emergency kit is the one way a backup key leaves this server.

  // A new PENDING key: backups keep using the current one until the admin
  // confirms its kit is saved (PUT below). Older keys are kept.
  fastify.post('/backups/encryption/key', async (request, reply) => {
    if (requireAdminSession(request, reply)) return
    await generateBackupKey()
    request.log.warn({ adminId: request.user!.id }, 'generated a new backup encryption key')
    return { encryption: await getBackupEncryptionStatus() }
  })

  fastify.put('/backups/encryption', async (request, reply) => {
    if (requireAdminSession(request, reply)) return
    const { enabled, kitSaved } = encryptionBody.parse(request.body)
    if (enabled && kitSaved !== true) {
      return reply.status(400).send({ error: getT(request)('errors.backupKitNotSaved') })
    }
    await setBackupEncryptionEnabled(enabled)
    request.log.warn({ adminId: request.user!.id, enabled }, 'changed backup encryption')
    return { encryption: await getBackupEncryptionStatus() }
  })

  // The kit of the pending key (else the current one), or of `?key=age1…`.
  fastify.get('/backups/encryption/kit', async (request, reply) => {
    if (requireAdminSession(request, reply)) return
    const key = await backupKeyForKit(kitQuery.parse(request.query).key)
    const text = emergencyKitText(key, await restoreConfirmName(), getT(request))
    request.log.warn({ adminId: request.user!.id, key: key.id }, 'downloaded a backup emergency kit')
    reply.header('content-type', 'text/plain; charset=utf-8')
    reply.header('content-disposition', 'attachment; filename="famlin-emergency-kit.txt"')
    reply.header('cache-control', 'no-store')
    return text
  })

  // A plain browser navigation, like GET /export: authenticated by a
  // one-time ?downloadToken= from POST /export/token when there's no header.
  fastify.get(
    '/backups/:file/download',
    { exposeHeadRoute: false, config: { exportDownloadToken: true } },
    async (request, reply) => {
      if (requireAdmin(request, reply)) return
      const { file } = fileParams.parse(request.params)
      const filePath = backupFilePath(file)
      const stat = filePath ? await fsp.lstat(filePath).catch(() => null) : null
      if (!filePath || !stat?.isFile()) {
        return reply.status(404).send({ error: getT(request)('errors.restoreDumpUnknown') })
      }
      // Served as stored: an encrypted `.zip.age` is opaque bytes.
      reply.header('content-type', file.endsWith('.zip') ? 'application/zip' : 'application/octet-stream')
      reply.header('content-length', String(stat.size))
      reply.header('content-disposition', `attachment; filename="${file}"`)
      reply.header('cache-control', 'no-store')
      return reply.send(fs.createReadStream(filePath))
    }
  )

  // Destructive, so a signed-in admin only — never an API token.
  fastify.delete('/backups/:file', async (request, reply) => {
    if (requireAdminSession(request, reply)) return
    const t = getT(request)
    const { file } = fileParams.parse(request.params)
    if (isBackupRunning() || isRestoreRunning()) return reply.status(409).send({ error: t('errors.backupInProgress') })
    const filePath = backupFilePath(file)
    const stat = filePath ? await fsp.lstat(filePath).catch(() => null) : null
    if (!filePath || !stat?.isFile()) return reply.status(404).send({ error: t('errors.restoreDumpUnknown') })
    if (backupFileKind(file) === 'archive') await removeBackupArchive(BACKUP_ARCHIVE_DIR, file)
    else await fsp.rm(filePath)
    return reply.status(204).send()
  })

  // Replaces everything on this server with the backup, after a safety
  // backup of the current state (services/backup/restoreRunning.ts). A
  // signed-in admin only, never an API token: restoring resets every
  // account's password to the backup's, which no token should be able to
  // do. The admin confirms by typing the family's name. Runs in the
  // background — 202, then GET /api/auth/restore-status; every session,
  // the admin's own included, ends when it completes. An encrypted backup
  // whose key this server lacks 400s backupKeyRequired until `key` (the
  // emergency kit) is sent.
  fastify.post(
    '/backups/:file/restore',
    { config: { rateLimit: { max: 3, timeWindow: '1 hour' } } },
    async (request, reply) => {
      if (requireAdminSession(request, reply)) return
      const t = getT(request)
      const { file } = fileParams.parse(request.params)
      const { confirm, key } = restoreBody.parse(request.body)
      const expected = await restoreConfirmName()
      if (confirm.trim().toLowerCase() !== expected.toLowerCase()) {
        return reply.status(400).send({ error: t('errors.restoreConfirmMismatch', { name: expected }) })
      }
      try {
        const { done } = await startRunningRestore(file, request.log, key)
        request.log.warn({ file, adminId: request.user!.id }, 'restoring a backup onto this running server')
        void done
      } catch (err) {
        if (!(err instanceof RunningRestoreError)) throw err
        if (err.code === 'unknownBackup') return reply.status(404).send({ error: t('errors.restoreDumpUnknown') })
        return reply.status(409).send({ error: t('errors.backupInProgress') })
      }
      return reply.status(202).send({ started: true })
    }
  )
}
