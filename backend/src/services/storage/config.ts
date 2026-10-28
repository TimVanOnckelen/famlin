import { realpathSync, existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { uploadsDir } from '../../config.js'
import { LocalStorageBackend } from './local.js'
import { S3StorageBackend, type S3Options } from './s3.js'
import type { StorageBackend } from './types.js'

export type StorageLocation =
  | { driver: 'local'; directory: string }
  | { driver: 's3'; bucket: string; prefix: string; endpoint?: string; region: string; forcePathStyle: boolean }
export interface StorageConfiguration {
  backend: StorageBackend
  location: StorageLocation
  fingerprint: string
}
export function readStorageConfig(env: NodeJS.ProcessEnv, fallback = false): StorageConfiguration | null {
  const stem = fallback ? 'STORAGE_FALLBACK_' : ''
  const driver = env[fallback ? 'STORAGE_FALLBACK_DRIVER' : 'STORAGE_DRIVER'] || (fallback ? undefined : 'local')
  if (!driver) return null
  let backend: StorageBackend
  let location: StorageLocation
  if (driver === 'local') {
    location = { driver, directory: canonicalDirectory(path.resolve(env[`${stem}UPLOADS_DIR`] ?? uploadsDir)) }
    if (fallback && (!existsSync(location.directory) || !statSync(location.directory).isDirectory()))
      throw new Error('Fallback storage directory must already exist')
    backend = new LocalStorageBackend(location.directory)
  } else if (driver === 's3') {
    const get = (name: string) => env[`${stem}S3_${name}`] || undefined
    const bucket = get('BUCKET')
    if (!bucket) throw new Error(`${stem}S3_BUCKET is required`)
    const accessKeyId = get('ACCESS_KEY_ID'),
      secretAccessKey = get('SECRET_ACCESS_KEY')
    if (!!accessKeyId !== !!secretAccessKey || (get('SESSION_TOKEN') && !accessKeyId))
      throw new Error('S3 credentials must be configured together')
    let endpoint = get('ENDPOINT')
    if (endpoint) {
      let url: URL
      try {
        url = new URL(endpoint)
      } catch {
        throw new Error('Invalid S3 endpoint')
      }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
        throw new Error('Invalid S3 endpoint')
      endpoint = url.toString().replace(/\/$/, '')
    }
    const style = get('FORCE_PATH_STYLE') ?? 'false'
    if (!['true', 'false'].includes(style)) throw new Error('S3_FORCE_PATH_STYLE must be true or false')
    const prefix = (get('PREFIX') ?? '').replace(/^\/+|\/+$/g, '')
    if (prefix && prefix.split('/').some((s) => !/^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(s)))
      throw new Error('Invalid S3 prefix')
    const options: S3Options = {
      bucket,
      prefix: prefix ? `${prefix}/` : '',
      endpoint,
      region: get('REGION') ?? 'us-east-1',
      forcePathStyle: style === 'true',
      credentials:
        accessKeyId && secretAccessKey
          ? { accessKeyId, secretAccessKey, sessionToken: get('SESSION_TOKEN') }
          : undefined,
    }
    location = {
      driver,
      bucket,
      prefix: options.prefix,
      endpoint,
      region: options.region,
      forcePathStyle: options.forcePathStyle,
    }
    backend = new S3StorageBackend(options)
  } else throw new Error('Unsupported storage driver')
  return { backend, location, fingerprint: createHash('sha256').update(JSON.stringify(location)).digest('hex') }
}
export function assertDisjoint(a: StorageLocation, b: StorageLocation): void {
  if (a.driver !== b.driver) return
  if (a.driver === 'local' && b.driver === 'local') {
    if (
      [path.relative(a.directory, b.directory), path.relative(b.directory, a.directory)].some(
        (p) => p === '' || (!p.startsWith(`..${path.sep}`) && p !== '..' && !path.isAbsolute(p))
      )
    )
      throw new Error('Storage directories overlap')
  }
  if (
    a.driver === 's3' &&
    b.driver === 's3' &&
    a.bucket === b.bucket &&
    endpointIdentity(a.endpoint) === endpointIdentity(b.endpoint) &&
    (a.prefix.startsWith(b.prefix) || b.prefix.startsWith(a.prefix))
  )
    throw new Error('Storage prefixes overlap')
}

// Resolve existing ancestors too, so a symlinked parent cannot disguise
// overlapping source/destination directories before their roots exist.
function canonicalDirectory(directory: string): string {
  if (existsSync(directory)) return realpathSync(directory)
  const parent = path.dirname(directory)
  return parent === directory ? directory : path.join(canonicalDirectory(parent), path.basename(directory))
}

function endpointIdentity(endpoint?: string): string {
  if (!endpoint) return 'aws'
  const url = new URL(endpoint)
  if (
    url.protocol === 'https:' &&
    !url.port &&
    (url.pathname === '/' || !url.pathname) &&
    /^s3([.-][a-z0-9-]+)?\.amazonaws\.com$/.test(url.hostname)
  )
    return 'aws'
  return endpoint
}
