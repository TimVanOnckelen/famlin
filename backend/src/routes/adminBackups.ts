import fs from 'fs'
import fsp from 'fs/promises'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireAdmin } from '../plugins/auth.js'
import { getT } from '../i18n/index.js'
import { getAllSettings } from '../services/settings.js'
import { backupKeyInputSchema } from '../types.js'
import { listBackups, removeBackupArchive, parseBackupArchiveFileName } from '../services/backup/archive.js'
import {
  BackupEncryptionError,
  backupIdentityFor,
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

const encryptionBody = z.object({
  enabled: z.boolean(),
  // Turning encryption on: the admin confirms the emergency kit is stored
  // somewhere other than this server (issue #495).
  kitSaved: z.boolean().optional(),
})
const kitQuery = z.object({ key: z.string().max(200).optional() })

export default async function adminBackupRoutes(fastify: FastifyInstance) {
  fastify.get('/backups', async (request, reply) => {
    if (requireAdmin(request, reply)) return
    const encryption = await getBackupEncryptionStatus()
    return {
      backups: await listBackups(
        BACKUP_ARCHIVE_DIR,
        BACKUP_DB_DIR,
        encryption.keys.map((k) => k.id)
      ),
      backupRunning: isBackupRunning(),
      restore: getRestoreStatus(),
      confirmName: await restoreConfirmName(),
      encryption,
    }
  })

  // Backup encryption (issue #495). Key management is a signed-in admin
  // only, never an API token: the emergency kit is the one way a backup key
  // leaves this server.

  // Generates a new key and makes it the one new backups use. Older keys
  // stay, so this server can still restore the backups made with them.
  fastify.post('/backups/encryption/key', async (request, reply) => {
    if (requireAdmin(request, reply)) return
    if (request.authMethod !== 'session') {
      return reply.status(403).send({ error: getT(request)('errors.sessionRequired') })
    }
    await generateBackupKey()
    request.log.warn({ adminId: request.user!.id }, 'generated a new backup encryption key')
    return { encryption: await getBackupEncryptionStatus() }
  })

  fastify.put('/backups/encryption', async (request, reply) => {
    if (requireAdmin(request, reply)) return
    const t = getT(request)
    if (request.authMethod !== 'session') return reply.status(403).send({ error: t('errors.sessionRequired') })
    const { enabled, kitSaved } = encryptionBody.parse(request.body)
    if (enabled && kitSaved !== true) return reply.status(400).send({ error: t('errors.backupKitNotSaved') })
    try {
      await setBackupEncryptionEnabled(enabled)
    } catch (err) {
      if (!(err instanceof BackupEncryptionError)) throw err
      return reply.status(400).send({ error: t('errors.backupKeyMissing') })
    }
    request.log.warn({ adminId: request.user!.id, enabled }, 'changed backup encryption')
    return { encryption: await getBackupEncryptionStatus() }
  })

  // The emergency kit of the current key, or of an older one by its public
  // key (`?key=age1…`): an age identity file with instructions.
  fastify.get('/backups/encryption/kit', async (request, reply) => {
    if (requireAdmin(request, reply)) return
    const t = getT(request)
    if (request.authMethod !== 'session') return reply.status(403).send({ error: t('errors.sessionRequired') })
    const { key } = kitQuery.parse(request.query)
    const status = await getBackupEncryptionStatus()
    const id = key ?? status.currentKey?.id
    const meta = status.keys.find((k) => k.id === id)
    if (!id || !meta) return reply.status(404).send({ error: t('errors.backupKeyMissing') })
    const identity = await backupIdentityFor(id)
    const text = emergencyKitText({ ...meta, identity }, await restoreConfirmName(), {
      title: t('backupKit.title'),
      instance: t('backupKit.instance'),
      created: t('backupKit.created'),
      publicKey: t('backupKit.publicKey'),
      body: t('backupKit.body').split('\n'),
    })
    request.log.warn({ adminId: request.user!.id, key: id }, 'downloaded a backup emergency kit')
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
      // An encrypted backup downloads as stored (still encrypted).
      const zip = backupFileKind(file) === 'archive' && file.endsWith('.zip')
      reply.header('content-type', zip ? 'application/zip' : 'application/octet-stream')
      reply.header('content-length', String(stat.size))
      reply.header('content-disposition', `attachment; filename="${file}"`)
      reply.header('cache-control', 'no-store')
      return reply.send(fs.createReadStream(filePath))
    }
  )

  // Destructive, so a signed-in admin only — never an API token.
  fastify.delete('/backups/:file', async (request, reply) => {
    if (requireAdmin(request, reply)) return
    const t = getT(request)
    if (request.authMethod !== 'session') return reply.status(403).send({ error: t('errors.sessionRequired') })
    const { file } = fileParams.parse(request.params)
    if (isBackupRunning() || isRestoreRunning()) return reply.status(409).send({ error: t('errors.backupInProgress') })
    const filePath = backupFilePath(file)
    const stat = filePath ? await fsp.lstat(filePath).catch(() => null) : null
    if (!filePath || !stat?.isFile()) return reply.status(404).send({ error: t('errors.restoreDumpUnknown') })
    if (parseBackupArchiveFileName(file)) await removeBackupArchive(BACKUP_ARCHIVE_DIR, file)
    else await fsp.rm(filePath)
    return reply.status(204).send()
  })

  // Replaces everything on this server with the backup, after a safety
  // backup of the current state (services/backup/restoreRunning.ts). A
  // signed-in admin only, never an API token: restoring resets every
  // account's password to the backup's, which no token should be able to
  // do. The admin confirms by typing the family's name. Runs in the
  // background — 202, then GET /api/auth/restore-status; every session,
  // the admin's own included, ends when it completes.
  fastify.post(
    '/backups/:file/restore',
    { config: { rateLimit: { max: 3, timeWindow: '1 hour' } } },
    async (request, reply) => {
      if (requireAdmin(request, reply)) return
      const t = getT(request)
      if (request.authMethod !== 'session') return reply.status(403).send({ error: t('errors.sessionRequired') })
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
        // The client asks for the emergency kit and retries.
        if (err.code === 'keyRequired')
          return reply.status(400).send({ error: t('errors.backupKeyRequired'), code: 'backupKeyRequired' })
        if (err.code === 'keyMismatch')
          return reply.status(400).send({ error: t('errors.backupKeyMismatch'), code: 'backupKeyMismatch' })
        return reply.status(409).send({ error: t('errors.backupInProgress') })
      }
      return reply.status(202).send({ started: true })
    }
  )
}
