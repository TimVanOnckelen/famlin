import { getStorage } from './storage/registry.js'
import fs from 'fs'
import fsp from 'fs/promises'
import path from 'path'
import { prisma } from '../db.js'
import { backupsDir, uploadsDir } from '../config.js'
import {
  getAllSettings,
  getImmichSettings,
  getLocalMediaSettings,
  getOidcSettings,
  type ServerSettings,
} from './settings.js'
import { JOB_IDS } from './jobRuns.js'
import { BACKUP_DB_DIR, backupIntervalMs, isBackupRunning } from './backup/index.js'
import { createTransporter } from './notificationChannels/email.js'
import { testImmichConnection } from './media/immich.js'

// Admin status panel (GET /api/admin/status and /status/integrations, issue
// #228). Everything here is read-only; the alert conditions it surfaces are
// computed in services/systemAlerts.ts so the banner, the panel and the alert
// emails can't disagree.

const HOUR_MS = 60 * 60 * 1000
const GIB = 1024 * 1024 * 1024

// A volume counts as low on space below 1 GiB free or below 5% free,
// whichever trips first.
export const LOW_DISK_FREE_BYTES = GIB
export const LOW_DISK_FREE_FRACTION = 0.05

export interface DiskUsage {
  path: string
  freeBytes: number
  totalBytes: number
  low: boolean
}

export function isLowDisk(freeBytes: number, totalBytes: number): boolean {
  return freeBytes < LOW_DISK_FREE_BYTES || (totalBytes > 0 && freeBytes / totalBytes < LOW_DISK_FREE_FRACTION)
}

// null when the directory doesn't exist (e.g. backups never enabled).
export async function getDiskUsage(dir: string): Promise<DiskUsage | null> {
  try {
    const stats = await fsp.statfs(dir)
    const freeBytes = stats.bavail * stats.bsize
    const totalBytes = stats.blocks * stats.bsize
    return { path: dir, freeBytes, totalBytes, low: isLowDisk(freeBytes, totalBytes) }
  } catch {
    return null
  }
}

// Whether `dir` is its own mount point — i.e. a volume or bind mount rather
// than the container's ephemeral filesystem, where a backup wouldn't survive
// the container. null when it can't be told (not Linux, dir missing).
export async function isMountPoint(dir: string): Promise<boolean | null> {
  try {
    const [real, mountinfo] = await Promise.all([fsp.realpath(dir), fsp.readFile('/proc/self/mountinfo', 'utf8')])
    // Field 5 is the mount point, with spaces etc. octal-escaped.
    return mountinfo
      .split('\n')
      .map((line) => line.split(' ')[4])
      .filter(Boolean)
      .some((mount) => mount.replace(/\\(\d{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8))) === real)
  } catch {
    return null
  }
}

// Whether two existing paths live on the same filesystem, so a low-space
// condition on both is reported once rather than twice.
export function sameDevice(a: string, b: string): boolean {
  try {
    return fs.statSync(a).dev === fs.statSync(b).dev
  } catch {
    return false
  }
}

// The next time the hourly scheduler tick will start a backup, or null when
// backups are off. Mirrors isBackupDue() in services/backup/index.ts.
export function nextBackupAt(
  now: Date,
  settings: Pick<ServerSettings, 'backupEnabled' | 'backupSchedule' | 'backupHour'>
): Date | null {
  if (!settings.backupEnabled) return null
  const candidate = new Date(now)
  candidate.setMinutes(0, 0, 0)
  for (let i = 0; i < 8 * 24; i++) {
    candidate.setTime(candidate.getTime() + HOUR_MS)
    if (candidate.getHours() !== settings.backupHour) continue
    if (settings.backupSchedule === 'weekly' && candidate.getDay() !== 0) continue
    return candidate
  }
  return null
}

async function listDumps(): Promise<{ file: string; bytes: number; createdAt: string }[]> {
  try {
    const names = (await fsp.readdir(BACKUP_DB_DIR)).filter((n) => n.startsWith('famlin-') && n.endsWith('.dump'))
    const dumps = await Promise.all(
      names.map(async (file) => {
        const stat = await fsp.stat(path.join(BACKUP_DB_DIR, file))
        return { file, bytes: stat.size, createdAt: stat.mtime.toISOString() }
      })
    )
    return dumps.sort((a, b) => b.file.localeCompare(a.file))
  } catch {
    return []
  }
}

export interface MigrationStatus {
  latestApplied: string | null
  appliedCount: number
  // null when the migrations folder isn't readable, so "pending" is unknown.
  pending: string[] | null
  // Started but never finished (and not rolled back) — prisma migrate deploy
  // refuses to continue until an admin resolves these.
  failed: string[]
}

export async function getMigrationStatus(): Promise<MigrationStatus> {
  const rows = await prisma.$queryRaw<
    { migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[]
  >`SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY migration_name`
  const applied = rows.filter((r) => r.finished_at && !r.rolled_back_at).map((r) => r.migration_name)
  const failed = rows.filter((r) => !r.finished_at && !r.rolled_back_at).map((r) => r.migration_name)

  let pending: string[] | null = null
  try {
    const entries = await fsp.readdir(path.join(process.cwd(), 'prisma', 'migrations'), { withFileTypes: true })
    const appliedSet = new Set(applied)
    pending = entries
      .filter((e) => e.isDirectory() && !appliedSet.has(e.name))
      .map((e) => e.name)
      .sort()
  } catch {
    // Not fatal for a status panel.
  }

  return { latestApplied: applied.at(-1) ?? null, appliedCount: applied.length, pending, failed }
}

export interface PushWindow {
  attempts: number
  delivered: number
  failed: number
  // failed / (delivered + failed); null with nothing sent.
  failureRate: number | null
}

// Above this failure rate (with at least PUSH_MIN_SENDS tokens tried) push
// delivery is flagged as unhealthy in the panel.
export const PUSH_UNHEALTHY_RATE = 0.2
const PUSH_MIN_SENDS = 10

async function pushWindow(since: Date): Promise<PushWindow> {
  const agg = await prisma.pushDeliveryLog.aggregate({
    where: { createdAt: { gte: since } },
    _count: { _all: true },
    _sum: { successCount: true, failureCount: true },
  })
  const delivered = agg._sum.successCount ?? 0
  const failed = agg._sum.failureCount ?? 0
  const total = delivered + failed
  return { attempts: agg._count._all, delivered, failed, failureRate: total > 0 ? failed / total : null }
}

export async function getPushHealth(now: Date) {
  const [last24h, last7d] = await Promise.all([
    pushWindow(new Date(now.getTime() - 24 * HOUR_MS)),
    pushWindow(new Date(now.getTime() - 7 * 24 * HOUR_MS)),
  ])
  const unhealthy =
    last24h.delivered + last24h.failed >= PUSH_MIN_SENDS && (last24h.failureRate ?? 0) > PUSH_UNHEALTHY_RATE
  return { last24h, last7d, unhealthy }
}

export async function getJobStatuses() {
  const rows = await prisma.jobStatus.findMany()
  const byId = new Map(rows.map((r) => [r.job, r]))
  return JOB_IDS.map((job) => {
    const row = byId.get(job)
    return {
      job,
      lastStartedAt: row?.lastStartedAt ?? null,
      lastFinishedAt: row?.lastFinishedAt ?? null,
      lastOk: row?.lastOk ?? null,
      lastError: row?.lastError ?? null,
      lastDurationMs: row?.lastDurationMs ?? null,
      lastSuccessAt: row?.lastSuccessAt ?? null,
      lastFailureAt: row?.lastFailureAt ?? null,
      lastDetails: row?.lastDetails ?? null,
      running: job === 'backup' ? isBackupRunning() : !!row && row.lastOk === null,
    }
  })
}

export async function getBackupOverview(now: Date) {
  const settings = await getAllSettings()
  const [dumps, dirIsMount] = await Promise.all([listDumps(), isMountPoint(backupsDir)])
  return {
    enabled: settings.backupEnabled,
    schedule: settings.backupSchedule,
    hour: settings.backupHour,
    retention: settings.backupRetention,
    intervalMs: backupIntervalMs(settings.backupSchedule),
    nextRunAt: nextBackupAt(now, settings),
    running: isBackupRunning(),
    dir: backupsDir,
    dirIsMount,
    dumps,
  }
}

export async function getDiskOverview() {
  const uploadsDriver = getStorage().id
  const [uploads, backups] = await Promise.all([
    uploadsDriver === 'local' ? getDiskUsage(uploadsDir) : Promise.resolve(null),
    getDiskUsage(backupsDir),
  ])
  return { uploadsDriver, uploads, backups, sameVolume: !!uploads && !!backups && sameDevice(uploadsDir, backupsDir) }
}

// --- Integrations ----------------------------------------------------------

export type IntegrationError = 'unreachable' | 'unauthorized' | 'not_found' | 'not_a_directory' | 'invalid_response'

export interface IntegrationStatus {
  configured: boolean
  // null when not configured (nothing to test).
  ok: boolean | null
  error?: IntegrationError
}

const PROBE_TIMEOUT_MS = 8000

function withTimeout<T>(promise: Promise<T>, ms = PROBE_TIMEOUT_MS): Promise<T> {
  let timer: NodeJS.Timeout
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), ms)
    }),
  ]).finally(() => clearTimeout(timer))
}

async function probeSmtp(): Promise<IntegrationStatus> {
  const transporter = await createTransporter()
  if (!transporter) return { configured: false, ok: null }
  try {
    await withTimeout(transporter.verify())
    return { configured: true, ok: true }
  } catch (err) {
    const code = (err as { code?: string } | null)?.code
    return { configured: true, ok: false, error: code === 'EAUTH' ? 'unauthorized' : 'unreachable' }
  } finally {
    transporter.close()
  }
}

// Fetches discovery fresh rather than through getDiscovery(), whose
// in-process cache would keep reporting a provider that has since gone away.
async function probeOidc(): Promise<IntegrationStatus> {
  const { issuer, clientId } = await getOidcSettings()
  if (!issuer || !clientId) return { configured: false, ok: null }
  try {
    const res = await fetch(`${issuer}/.well-known/openid-configuration`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    if (!res.ok) return { configured: true, ok: false, error: 'unreachable' }
    const doc = (await res.json()) as { jwks_uri?: unknown }
    return typeof doc.jwks_uri === 'string'
      ? { configured: true, ok: true }
      : { configured: true, ok: false, error: 'invalid_response' }
  } catch {
    return { configured: true, ok: false, error: 'unreachable' }
  }
}

async function probeImmich(): Promise<IntegrationStatus> {
  const { serverUrl, apiKey, configured } = await getImmichSettings()
  if (!configured) return { configured: false, ok: null }
  try {
    const result = await withTimeout(testImmichConnection(serverUrl, apiKey))
    return result.ok ? { configured: true, ok: true } : { configured: true, ok: false, error: result.error }
  } catch {
    return { configured: true, ok: false, error: 'unreachable' }
  }
}

// Backs both POST /api/admin/media/local/test and the status probe.
export async function testLocalMediaPath(
  rootPath: string
): Promise<{ ok: true } | { ok: false; error: 'not_found' | 'not_a_directory' }> {
  try {
    const stat = await fsp.stat(rootPath)
    if (!stat.isDirectory()) return { ok: false, error: 'not_a_directory' }
    await fsp.access(rootPath, fsp.constants.R_OK)
    return { ok: true }
  } catch {
    return { ok: false, error: 'not_found' }
  }
}

async function probeLocalMedia(): Promise<IntegrationStatus> {
  const { rootPath, configured } = await getLocalMediaSettings()
  if (!configured) return { configured: false, ok: null }
  const result = await testLocalMediaPath(rootPath)
  return result.ok ? { configured: true, ok: true } : { configured: true, ok: false, error: result.error }
}

export async function getIntegrationStatus() {
  const [smtp, oidc, immich, localMedia] = await Promise.all([
    probeSmtp(),
    probeOidc(),
    probeImmich(),
    probeLocalMedia(),
  ])
  return { smtp, oidc, immich, localMedia }
}
