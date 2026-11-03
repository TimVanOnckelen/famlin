import { getStorage } from './storage/registry.js'
import i18n from '../i18n/index.js'
import { prisma } from '../db.js'
import { backupsDir, uploadsDir } from '../config.js'
import { getAllSettings, type ServerSettings } from './settings.js'
import { backupIntervalMs } from './backup/index.js'
import { getDiskUsage, sameDevice } from './systemStatus.js'
import { createTransporter } from './notificationChannels/email.js'
import { isUniqueConstraintViolation } from '../utils/prismaErrors.js'

// Conditions that put a banner on /admin and email every admin (issue #228).
// The ids are persisted as SystemAlert primary keys — don't rename them.
export type AlertCondition = 'backup_failed' | 'backup_stale' | 'disk_low_uploads' | 'disk_low_backups'

export interface ActiveAlert {
  condition: AlertCondition
  // Interpolation values for the banner/email text.
  params: Record<string, string | number>
}

const DAY_MS = 24 * 60 * 60 * 1000
// At most one email per condition per this window.
export const ALERT_EMAIL_THROTTLE_MS = DAY_MS

export interface BackupAlertInput {
  enabled: boolean
  schedule: ServerSettings['backupSchedule']
  lastOk: boolean | null
  lastSuccessAt: Date | null
  // When backups were (last) switched on — the staleness reference before the
  // first successful backup exists.
  enabledSince: Date | null
}

// Pure, so the staleness rule is directly testable: a failed last run is
// `backup_failed`; otherwise no success for more than 2× the schedule
// interval is `backup_stale`. Neither applies while backups are off.
export function backupAlerts(input: BackupAlertInput, now: Date): ActiveAlert[] {
  if (!input.enabled) return []
  if (input.lastOk === false) return [{ condition: 'backup_failed', params: {} }]

  const reference = input.lastSuccessAt ?? input.enabledSince
  if (!reference) return []
  const ageMs = now.getTime() - reference.getTime()
  if (ageMs > 2 * backupIntervalMs(input.schedule)) {
    return [{ condition: 'backup_stale', params: { days: Math.floor(ageMs / DAY_MS) } }]
  }
  return []
}

function formatGiB(bytes: number): string {
  return (bytes / 1024 ** 3).toFixed(1)
}

export async function computeActiveAlerts(now = new Date()): Promise<ActiveAlert[]> {
  const settings = await getAllSettings()
  const [backupJob, enabledRow, uploadsDisk, backupsDisk] = await Promise.all([
    prisma.jobStatus.findUnique({ where: { job: 'backup' } }),
    prisma.setting.findUnique({ where: { key: 'backupEnabled' }, select: { updatedAt: true } }),
    getStorage().id === 'local' ? getDiskUsage(uploadsDir) : Promise.resolve(null),
    getDiskUsage(backupsDir),
  ])

  const alerts = backupAlerts(
    {
      enabled: settings.backupEnabled,
      schedule: settings.backupSchedule,
      lastOk: backupJob?.lastOk ?? null,
      lastSuccessAt: backupJob?.lastSuccessAt ?? null,
      enabledSince: enabledRow?.updatedAt ?? null,
    },
    now
  )

  if (uploadsDisk?.low) {
    alerts.push({ condition: 'disk_low_uploads', params: { free: formatGiB(uploadsDisk.freeBytes) } })
  }
  // The backups volume only matters while backups run, and is reported once
  // when it's the same filesystem as uploads.
  if (settings.backupEnabled && backupsDisk?.low && !(uploadsDisk?.low && sameDevice(uploadsDir, backupsDir))) {
    alerts.push({ condition: 'disk_low_backups', params: { free: formatGiB(backupsDisk.freeBytes) } })
  }
  return alerts
}

// Atomically claims the right to email about `condition` now: true at most
// once per throttle window, even with two checks racing (the hourly tick and
// a just-finished backup).
async function claimAlertEmail(condition: AlertCondition, now: Date): Promise<boolean> {
  const cutoff = new Date(now.getTime() - ALERT_EMAIL_THROTTLE_MS)
  const updated = await prisma.systemAlert.updateMany({
    where: { condition, lastEmailedAt: { lte: cutoff } },
    data: { lastEmailedAt: now },
  })
  if (updated.count > 0) return true
  try {
    await prisma.systemAlert.create({ data: { condition, lastEmailedAt: now } })
    return true
  } catch (err) {
    if (isUniqueConstraintViolation(err)) return false
    throw err
  }
}

// Indirection so tests can capture outgoing mail.
export const alertDeps = { createTransporter }

// Emails every admin about the alerts not already emailed within the
// throttle window, in one message. Needs SMTP; without it the banner is the
// only signal. Deliberately independent of the member-facing
// emailNotificationsEnabled switch. Returns the conditions it emailed about.
export async function sendAlertEmails(alerts: ActiveAlert[], now = new Date()): Promise<AlertCondition[]> {
  if (alerts.length === 0) return []
  const settings = await getAllSettings()
  const transporter = await alertDeps.createTransporter(settings)
  if (!transporter) return []

  const admins = await prisma.user.findMany({ where: { isAdmin: true }, select: { email: true } })
  if (admins.length === 0) return []

  const claimed: ActiveAlert[] = []
  for (const alert of alerts) {
    if (await claimAlertEmail(alert.condition, now)) claimed.push(alert)
  }
  if (claimed.length === 0) return []

  const t = i18n.getFixedT(settings.defaultLanguage)
  const lines = claimed.map((a) => `- ${t(`systemAlerts.${a.condition}`, a.params)}`)
  try {
    await transporter.sendMail({
      from: settings.smtpFrom || 'Famlin <noreply@famlin.app>',
      to: admins.map((a) => a.email),
      subject: t('systemAlerts.emailSubject'),
      text: t('systemAlerts.emailBody', { alerts: lines.join('\n') }),
    })
  } catch (err) {
    // Nothing went out, so don't let the claim suppress the next attempt.
    await prisma.systemAlert.deleteMany({ where: { condition: { in: claimed.map((a) => a.condition) } } })
    throw err
  } finally {
    transporter.close()
  }
  return claimed.map((a) => a.condition)
}

// The hourly `systemAlerts` job (server.ts), also run after every backup.
export async function runSystemAlertsCheck(now = new Date()): Promise<AlertCondition[]> {
  return sendAlertEmails(await computeActiveAlerts(now), now)
}
