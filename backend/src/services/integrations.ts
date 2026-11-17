import { prisma } from '../db.js'
import { getAllSettings, getImmichSettings } from './settings.js'
import { getIntegrationStatus, getJobStatuses, getPushHealth, type IntegrationStatus } from './systemStatus.js'
import { getStorageConfiguration, getStorageRuntimeStatus } from './storage/registry.js'
import type { JobId } from './jobRuns.js'

// The admin Integrations overview (GET /api/admin/integrations): every
// external service Famlin talks to, with one status that combines whether
// it's set up, whether the last connection check passed and whether the jobs
// that use it succeeded, plus what it's used for. It carries everything the
// integration pages show, so they need no request of their own.

export const INTEGRATION_IDS = ['immich', 'local', 'sso', 'apple', 'email', 'push', 'storage'] as const
export type IntegrationId = (typeof INTEGRATION_IDS)[number]

// 'off' = not set up / switched off, 'ok', 'attention' = works but something
// needs a look, 'failing' = the connection check or the service itself fails.
export type IntegrationState = 'off' | 'ok' | 'attention' | 'failing'

// Machine-readable reasons the admin UI translates. Only reported while the
// integration is set up: an integration that's off has nothing to fix.
export type IntegrationIssue =
  | 'checkFailed'
  | 'jobFailed'
  | 'mirrorFailures'
  | 'mirrorKeyMissing'
  | 'publicUrlMissing'
  | 'pushUnhealthy'
  | 'storageFallback'

type JobRow = Awaited<ReturnType<typeof getJobStatuses>>[number]

// One family's use of a photo source (the Families tab).
export interface IntegrationFamily {
  groupId: string
  name: string
  albums: string[]
  mirror: { albumName: string; enabled: boolean; mirrored: number; failed: number } | null
}

export interface IntegrationSummary {
  id: IntegrationId
  state: IntegrationState
  configured: boolean
  issues: IntegrationIssue[]
  // The last connection check, for integrations that have one.
  check: IntegrationStatus | null
  // The status rows of the jobs that act on this integration.
  jobs: JobRow[]
  usage: Record<string, string | number | boolean | null>
  families?: IntegrationFamily[]
  push?: Awaited<ReturnType<typeof getPushHealth>>
}

const JOBS: Partial<Record<IntegrationId, JobId[]>> = {
  immich: ['newAssets', 'mediaMirror'],
  local: ['newAssets'],
  email: ['systemAlerts'],
}

// Connection checks talk to other servers (up to an 8s timeout each), so the
// overview serves the last result and refreshes it in the background once it
// is older than this; "Check now" runs them right away. Saving settings
// invalidates the result (invalidateIntegrationChecks), and a check that
// started before that is never stored or reused.
const CHECK_MAX_AGE_MS = 5 * 60 * 1000
type Checks = Awaited<ReturnType<typeof getIntegrationStatus>>
let lastChecks: { results: Checks; checkedAt: Date } | null = null
let generation = 0
let inflight: { generation: number; promise: Promise<void> } | null = null

export function invalidateIntegrationChecks(): void {
  generation++
  lastChecks = null
}

export function runIntegrationChecks(): Promise<void> {
  if (inflight?.generation === generation) return inflight.promise
  const started = generation
  const promise = getIntegrationStatus()
    .then((results) => {
      if (started === generation) lastChecks = { results, checkedAt: new Date() }
    })
    .finally(() => {
      if (inflight?.promise === promise) inflight = null
    })
  inflight = { generation: started, promise }
  return promise
}

// Test-only: forget cached checks between tests.
export function __resetIntegrationChecksForTests() {
  invalidateIntegrationChecks()
}

export async function getIntegrationsOverview(options: { check?: boolean } = {}): Promise<{
  checkedAt: string | null
  integrations: IntegrationSummary[]
}> {
  if (options.check || !lastChecks) {
    if (options.check) invalidateIntegrationChecks()
    // A save during the check makes its result stale and unstored: run again.
    for (let attempt = 0; attempt < 3 && !lastChecks; attempt++) await runIntegrationChecks()
  } else if (Date.now() - lastChecks.checkedAt.getTime() > CHECK_MAX_AGE_MS) {
    runIntegrationChecks().catch(() => {})
  }
  const checks = lastChecks?.results ?? null

  const now = new Date()
  const [settings, mirrorKey, jobs, push, groups, links, targets, mirrorCounts, pushTokens] = await Promise.all([
    getAllSettings(),
    getImmichSettings('mirror'),
    getJobStatuses(),
    getPushHealth(now),
    prisma.group.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.mediaAlbumLink.findMany({
      select: { provider: true, groupId: true, albumName: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.mediaMirrorTarget.findMany(),
    prisma.mediaMirror.groupBy({ by: ['externalAlbumId', 'status'], _count: { _all: true } }),
    prisma.pushToken.count(),
  ])

  const mirrorCount = (albumId: string, status: string) =>
    mirrorCounts.find((row) => row.externalAlbumId === albumId && row.status === status)?._count._all ?? 0
  const familiesFor = (provider: string): IntegrationFamily[] =>
    groups.map((group) => {
      const target = provider === 'immich' ? targets.find((t) => t.groupId === group.id) : undefined
      return {
        groupId: group.id,
        name: group.name,
        albums: links.filter((l) => l.provider === provider && l.groupId === group.id).map((l) => l.albumName),
        mirror: target
          ? {
              albumName: target.albumName,
              enabled: target.enabled,
              mirrored: mirrorCount(target.externalAlbumId, 'mirrored'),
              failed: mirrorCount(target.externalAlbumId, 'failed'),
            }
          : null,
      }
    })

  const summaries: IntegrationSummary[] = []
  const add = (
    id: IntegrationId,
    configured: boolean,
    check: IntegrationStatus | null,
    issues: (IntegrationIssue | false)[],
    usage: IntegrationSummary['usage'],
    extra: Pick<IntegrationSummary, 'families' | 'push'> = {}
  ) => {
    const ownJobs = jobs.filter((job) => JOBS[id]?.includes(job.job))
    const found = configured
      ? [
          ...(check?.ok === false ? (['checkFailed'] as const) : []),
          ...issues.filter((issue): issue is IntegrationIssue => !!issue),
          ...(ownJobs.some((job) => job.lastOk === false) ? (['jobFailed'] as const) : []),
        ]
      : []
    const state: IntegrationState = !configured
      ? 'off'
      : check?.ok === false || found.includes('storageFallback')
        ? 'failing'
        : found.length > 0
          ? 'attention'
          : 'ok'
    summaries.push({ id, state, configured, issues: found, check, jobs: ownJobs, usage, ...extra })
  }

  const immichFamilies = familiesFor('immich')
  const mirroring = targets.filter((target) => target.enabled).length
  const mirrorFailures = immichFamilies.reduce((sum, family) => sum + (family.mirror?.failed ?? 0), 0)
  const linkUsage = (families: IntegrationFamily[]) => ({
    families: families.filter((family) => family.albums.length > 0).length,
    albums: families.reduce((sum, family) => sum + family.albums.length, 0),
  })
  add(
    'immich',
    !!checks?.immich.configured,
    checks?.immich ?? null,
    [mirrorFailures > 0 && 'mirrorFailures', mirroring > 0 && !mirrorKey.configured && 'mirrorKeyMissing'],
    { ...linkUsage(immichFamilies), mirroring },
    { families: immichFamilies }
  )

  const localFamilies = familiesFor('local')
  add('local', !!checks?.localMedia.configured, checks?.localMedia ?? null, [], linkUsage(localFamilies), {
    families: localFamilies,
  })

  add('sso', !!checks?.oidc.configured, checks?.oidc ?? null, [], {
    name: settings.oidcName,
    issuerHost: settings.oidcIssuer ? safeHost(settings.oidcIssuer) : null,
  })

  // Sign in with Apple needs no setup for the official app.
  const extraBundleIds = settings.appleBundleIds.split(',').filter((id) => id.trim()).length
  add('apple', true, null, [], { extraBundleIds })

  add('email', !!checks?.smtp.configured, checks?.smtp ?? null, [!settings.publicUrl && 'publicUrlMissing'], {
    host: settings.smtpHost || null,
    notifications: settings.emailNotificationsEnabled,
  })

  add(
    'push',
    settings.pushNotificationsEnabled,
    null,
    [push.unhealthy && 'pushUnhealthy'],
    { devices: pushTokens, deliveredLast7d: push.last7d.delivered, failedLast7d: push.last7d.failed },
    { push }
  )

  const { primary, fallback } = getStorageConfiguration()
  add('storage', true, null, [getStorageRuntimeStatus().usingFallback && 'storageFallback'], {
    driver: primary.location.driver,
    fallbackDriver: fallback?.location.driver ?? null,
  })

  return { checkedAt: lastChecks?.checkedAt.toISOString() ?? null, integrations: summaries }
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).host
  } catch {
    return null
  }
}
