import { prisma } from '../db.js'
import { getAllSettings, getImmichSettings } from './settings.js'
import {
  getJobStatuses,
  getPushHealth,
  probeImmich,
  probeLocalMedia,
  probeOidc,
  probeSmtp,
  type IntegrationStatus,
} from './systemStatus.js'
import { getStorageConfiguration, getStorageRuntimeStatus } from './storage/registry.js'
import type { JobId } from './jobRuns.js'

// The admin Integrations overview (GET /api/admin/integrations): every
// external service Famlin talks to, with one status that combines whether
// it's set up, whether the last connection check passed and whether the jobs
// that use it succeeded, plus what it's used for.

export const INTEGRATION_IDS = ['immich', 'local', 'sso', 'apple', 'email', 'push', 'storage'] as const
export type IntegrationId = (typeof INTEGRATION_IDS)[number]

// 'off' = not set up / switched off, 'ok', 'attention' = works but something
// needs a look, 'failing' = the connection check or the service itself fails.
export type IntegrationState = 'off' | 'ok' | 'attention' | 'failing'

// Machine-readable reasons the admin UI translates.
export type IntegrationIssue =
  | 'checkFailed'
  | 'jobFailed'
  | 'mirrorFailures'
  | 'mirrorKeyMissing'
  | 'publicUrlMissing'
  | 'emailDisabled'
  | 'pushUnhealthy'
  | 'storageFallback'

export interface IntegrationSummary {
  id: IntegrationId
  state: IntegrationState
  configured: boolean
  issues: IntegrationIssue[]
  // The last connection check, for integrations that have one.
  check: (IntegrationStatus & { checkedAt: string }) | null
  // Jobs that act on this integration (their status rows).
  jobs: JobId[]
  usage: Record<string, string | number | boolean | null>
}

const JOBS: Partial<Record<IntegrationId, JobId[]>> = {
  immich: ['newAssets', 'mediaMirror'],
  local: ['newAssets'],
  email: ['systemAlerts'],
}

type Probe = 'smtp' | 'oidc' | 'immich' | 'local'
const PROBES: Record<Probe, () => Promise<IntegrationStatus>> = {
  smtp: probeSmtp,
  oidc: probeOidc,
  immich: probeImmich,
  local: probeLocalMedia,
}

// Connection checks talk to other servers (up to an 8s timeout each), so the
// overview serves the last result and refreshes it in the background once it
// is older than this; "Check now" runs them right away.
const CHECK_MAX_AGE_MS = 5 * 60 * 1000
let lastChecks: { results: Record<Probe, IntegrationStatus>; checkedAt: Date } | null = null
let checking: Promise<void> | null = null

export function runIntegrationChecks(): Promise<void> {
  checking ??= (async () => {
    try {
      const entries = await Promise.all(
        (Object.keys(PROBES) as Probe[]).map(async (probe) => [probe, await PROBES[probe]()] as const)
      )
      lastChecks = { results: Object.fromEntries(entries) as Record<Probe, IntegrationStatus>, checkedAt: new Date() }
    } finally {
      checking = null
    }
  })()
  return checking
}

// Test-only: forget cached checks between tests.
export function __resetIntegrationChecksForTests() {
  lastChecks = null
}

function stateOf(configured: boolean, issues: IntegrationIssue[], check: IntegrationStatus | null): IntegrationState {
  if (!configured) return 'off'
  if (check?.ok === false || issues.includes('storageFallback')) return 'failing'
  return issues.length > 0 ? 'attention' : 'ok'
}

export async function getIntegrationsOverview(options: { check?: boolean } = {}): Promise<{
  checkedAt: string | null
  integrations: IntegrationSummary[]
}> {
  if (options.check || !lastChecks) await runIntegrationChecks()
  else if (Date.now() - lastChecks.checkedAt.getTime() > CHECK_MAX_AGE_MS) runIntegrationChecks().catch(() => {})
  const checks = lastChecks
  const checkFor = (probe: Probe) =>
    checks ? { ...checks.results[probe], checkedAt: checks.checkedAt.toISOString() } : null

  const now = new Date()
  const [settings, mirrorKey, jobs, push, links, mirrorTargets, mirrorFailures, pushTokens, passwordless] =
    await Promise.all([
      getAllSettings(),
      getImmichSettings('mirror'),
      getJobStatuses(),
      getPushHealth(now),
      prisma.mediaAlbumLink.findMany({ select: { provider: true, groupId: true } }),
      prisma.mediaMirrorTarget.findMany({ select: { enabled: true } }),
      prisma.mediaMirror.count({ where: { status: 'failed' } }),
      prisma.pushToken.count(),
      prisma.user.count({ where: { passwordHash: null } }),
    ])
  const failedJob = (ids: JobId[] = []) => jobs.some((job) => ids.includes(job.job) && job.lastOk === false)

  const linkUsage = (provider: string) => {
    const own = links.filter((link) => link.provider === provider)
    return { families: new Set(own.map((link) => link.groupId)).size, albums: own.length }
  }

  const summaries: IntegrationSummary[] = []
  const add = (
    id: IntegrationId,
    configured: boolean,
    check: IntegrationSummary['check'],
    issues: (IntegrationIssue | false)[],
    usage: IntegrationSummary['usage']
  ) => {
    const real = issues.filter((issue): issue is IntegrationIssue => !!issue)
    if (check?.ok === false) real.unshift('checkFailed')
    if (configured && failedJob(JOBS[id])) real.push('jobFailed')
    summaries.push({
      id,
      state: stateOf(configured, real, check),
      configured,
      issues: real,
      check,
      jobs: JOBS[id] ?? [],
      usage,
    })
  }

  const immich = checkFor('immich')
  const mirroring = mirrorTargets.filter((target) => target.enabled).length
  add(
    'immich',
    !!immich?.configured,
    immich,
    [mirrorFailures > 0 && 'mirrorFailures', mirroring > 0 && !mirrorKey.configured && 'mirrorKeyMissing'],
    { ...linkUsage('immich'), mirroring, uploadKey: mirrorKey.configured, mirrorFailures }
  )

  const local = checkFor('local')
  add('local', !!local?.configured, local, [], { ...linkUsage('local'), path: settings.localMediaPath || null })

  const sso = checkFor('oidc')
  add('sso', !!sso?.configured, sso, [], {
    name: settings.oidcName,
    issuerHost: settings.oidcIssuer ? safeHost(settings.oidcIssuer) : null,
    accountsWithoutPassword: passwordless,
  })

  // Sign in with Apple needs no setup for the official app.
  const extraBundleIds = settings.appleBundleIds.split(',').filter((id) => id.trim()).length
  add('apple', true, null, [], { extraBundleIds })

  const email = checkFor('smtp')
  add(
    'email',
    !!email?.configured,
    email,
    [!settings.publicUrl && 'publicUrlMissing', !settings.emailNotificationsEnabled && 'emailDisabled'],
    { host: settings.smtpHost || null, notifications: settings.emailNotificationsEnabled }
  )

  add('push', settings.pushNotificationsEnabled, null, [push.unhealthy && 'pushUnhealthy'], {
    devices: pushTokens,
    deliveredLast7d: push.last7d.delivered,
    failedLast7d: push.last7d.failed,
  })

  const { primary, fallback } = getStorageConfiguration()
  add('storage', true, null, [getStorageRuntimeStatus().usingFallback && 'storageFallback'], {
    driver: primary.location.driver,
    fallbackDriver: fallback?.location.driver ?? null,
  })

  return { checkedAt: checks?.checkedAt.toISOString() ?? null, integrations: summaries }
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).host
  } catch {
    return null
  }
}
