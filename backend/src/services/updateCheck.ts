import { prisma } from '../db.js'
import { getAllSettings } from './settings.js'
import pkg from '../../package.json' with { type: 'json' }

// Admin "update available" notice (issue #347). A daily job asks GitHub for
// the latest release and stores the outcome in one `Setting` row; the admin
// status endpoint compares it with the running version at read time, so the
// notice disappears the moment the server is upgraded. The request carries no
// information about the instance, and an admin can switch it off
// (`updateCheckEnabled`).
//
// `updateCheckResult` is deliberately not part of ServerSettings/SETTING_KEYS:
// the generic admin settings GET/PATCH never expose or accept it.

const LATEST_RELEASE_URL = 'https://api.github.com/repos/TimVanOnckelen/famlin/releases/latest'
const RESULT_KEY = 'updateCheckResult'
const FETCH_TIMEOUT_MS = 10_000

export interface StoredUpdateCheck {
  latest: string
  url: string
  breaking: boolean
  checkedAt: string
}

export interface UpdateNotice extends StoredUpdateCheck {
  current: string
  updateAvailable: boolean
}

interface ParsedVersion {
  core: [number, number, number]
  pre: string[]
}

function parseVersion(input: string): ParsedVersion | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec(input.trim())
  if (!m) return null
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split('.') : [] }
}

// Semver precedence (build metadata ignored): negative if a < b, 0 if equal,
// positive if a > b. Returns null when either side isn't a version.
export function compareVersions(a: string, b: string): number | null {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (!pa || !pb) return null
  for (let i = 0; i < 3; i++) {
    if (pa.core[i] !== pb.core[i]) return pa.core[i] < pb.core[i] ? -1 : 1
  }
  // A version without a prerelease tag outranks one with it.
  if (pa.pre.length === 0 || pb.pre.length === 0)
    return pa.pre.length === pb.pre.length ? 0 : pa.pre.length === 0 ? 1 : -1
  for (let i = 0; i < Math.max(pa.pre.length, pb.pre.length); i++) {
    const x = pa.pre[i]
    const y = pb.pre[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    if (x === y) continue
    const xn = /^\d+$/.test(x)
    const yn = /^\d+$/.test(y)
    if (xn && yn) return Number(x) < Number(y) ? -1 : 1
    if (xn !== yn) return xn ? -1 : 1
    return x < y ? -1 : 1
  }
  return 0
}

export async function fetchLatestRelease(): Promise<Omit<StoredUpdateCheck, 'checkedAt'>> {
  const res = await fetch(LATEST_RELEASE_URL, {
    headers: { 'User-Agent': 'famlin-server', Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`GitHub responded with ${res.status}`)
  const release = (await res.json()) as { tag_name?: unknown; html_url?: unknown; body?: unknown }
  if (typeof release.tag_name !== 'string' || typeof release.html_url !== 'string') {
    throw new Error('Unexpected GitHub release response')
  }
  const latest = release.tag_name.replace(/^v/, '')
  if (!parseVersion(latest)) throw new Error('Unrecognised release tag')
  return {
    latest,
    url: release.html_url,
    breaking: typeof release.body === 'string' && release.body.includes('BREAKING CHANGES'),
  }
}

export interface UpdateCheckRun {
  checked: boolean
  updateAvailable: boolean
}

// One run of the job. Resolves `{checked: false}` without touching the network
// when the check is disabled; throws on a network/GitHub failure (recordJobRun
// records it, callers swallow it) and leaves the previous result in place.
export async function runUpdateCheck(): Promise<UpdateCheckRun> {
  const settings = await getAllSettings()
  if (!settings.updateCheckEnabled) return { checked: false, updateAvailable: false }

  const release = await fetchLatestRelease()
  const stored: StoredUpdateCheck = { ...release, checkedAt: new Date().toISOString() }
  await prisma.setting.upsert({
    where: { key: RESULT_KEY },
    create: { key: RESULT_KEY, value: JSON.stringify(stored) },
    update: { value: JSON.stringify(stored) },
  })
  return { checked: true, updateAvailable: (compareVersions(stored.latest, pkg.version) ?? 0) > 0 }
}

function parseStored(raw: string): StoredUpdateCheck | null {
  try {
    const v = JSON.parse(raw) as Partial<StoredUpdateCheck>
    if (
      typeof v.latest === 'string' &&
      typeof v.url === 'string' &&
      typeof v.breaking === 'boolean' &&
      typeof v.checkedAt === 'string'
    ) {
      return { latest: v.latest, url: v.url, breaking: v.breaking, checkedAt: v.checkedAt }
    }
  } catch {
    // Corrupt row: treat as never checked.
  }
  return null
}

// null when the check is disabled or has never succeeded.
export async function getUpdateNotice(): Promise<UpdateNotice | null> {
  const settings = await getAllSettings()
  if (!settings.updateCheckEnabled) return null
  const row = await prisma.setting.findUnique({ where: { key: RESULT_KEY } })
  const stored = row ? parseStored(row.value) : null
  if (!stored) return null
  return {
    ...stored,
    current: pkg.version,
    updateAvailable: (compareVersions(stored.latest, pkg.version) ?? 0) > 0,
  }
}
