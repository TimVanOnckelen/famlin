import fs from 'fs'
import fsp from 'fs/promises'
import path from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import type { ReadableStream as NodeWebReadableStream } from 'stream/web'
import { Decrypter, Encrypter, generateX25519Identity, identityToRecipient } from 'age-encryption'
import type { Prisma } from '@prisma/client'
import { prisma } from '../../db.js'
import { BACKUP_KEYS_ADVISORY_LOCK_KEY } from '../setupLock.js'
import { RestoreError } from '../import.js'

// Encrypted backups (issue #495), modelled on Home Assistant's: the server
// generates an age X25519 identity and keeps it, so scheduled backups run
// unattended; the admin keeps a copy (the "emergency kit") somewhere else.
// The threat model is copies that LEAVE the server (off-site sync, a
// downloaded file) — whoever controls the server can read its key.
//
// These rows are deliberately outside ServerSettings/SETTING_KEYS (like
// `updateCheckResult`): the generic settings GET/PATCH never see them, the
// export never carries them, and a restore onto a running server
// (wipeForRestore) leaves them alone. The identities only ever leave the
// server through the emergency-kit download.
const ENABLED_KEY = 'backupEncryptionEnabled'
const KEYS_KEY = 'backupEncryptionKeys'
// A generated key the admin hasn't confirmed saving the kit of yet. It only
// becomes the key new backups use once they have (setBackupEncryptionEnabled
// with the kit confirmed) — first setup and rotation alike — so no backup is
// ever encrypted to a key that exists only on this server.
const PENDING_KEY = 'backupEncryptionPendingKey'

// Every age file starts with this line.
const AGE_MAGIC = Buffer.from('age-encryption.org/v1\n')
const IDENTITY_PATTERN = /AGE-SECRET-KEY-1[0-9A-Z]+/g

export interface BackupKey {
  // age1… — the public half, safe to show and to write next to a backup.
  id: string
  createdAt: string
}

interface StoredKey extends BackupKey {
  identity: string
}

export interface BackupEncryptionStatus {
  enabled: boolean
  // The key new backups are encrypted with; null until one is confirmed.
  currentKey: BackupKey | null
  // Generated, its kit not yet confirmed saved: not used for backups yet.
  pendingKey: BackupKey | null
  // Every key this server can still decrypt with, newest first.
  keys: BackupKey[]
}

// The code is also the i18n key (`errors.<code>`) and the `code` clients
// branch on: backupKeyRequired asks for the emergency kit, backupKeyMismatch
// says the given one doesn't open the backup. app.ts's error handler sends it.
export class BackupEncryptionError extends Error {
  constructor(
    readonly code: 'backupKeyMissing' | 'backupKeyRequired' | 'backupKeyMismatch',
    readonly httpStatus = 400
  ) {
    super(code)
    this.name = 'BackupEncryptionError'
  }
}

type Db = Prisma.TransactionClient | typeof prisma

function publicKey({ id, createdAt }: StoredKey): BackupKey {
  return { id, createdAt }
}

function isStoredKey(k: unknown): k is StoredKey {
  const key = k as StoredKey | null
  return !!key && typeof key.identity === 'string' && typeof key.id === 'string' && typeof key.createdAt === 'string'
}

async function readJson(db: Db, key: string): Promise<unknown> {
  const row = await db.setting.findUnique({ where: { key } })
  if (!row) return null
  try {
    return JSON.parse(row.value) as unknown
  } catch {
    return null
  }
}

async function readKeys(db: Db = prisma): Promise<StoredKey[]> {
  const parsed = await readJson(db, KEYS_KEY)
  return Array.isArray(parsed) ? parsed.filter(isStoredKey) : []
}

async function readPending(db: Db = prisma): Promise<StoredKey | null> {
  const parsed = await readJson(db, PENDING_KEY)
  return isStoredKey(parsed) ? parsed : null
}

async function writeSetting(db: Db, key: string, value: string): Promise<void> {
  await db.setting.upsert({ where: { key }, create: { key, value }, update: { value } })
}

function withKeysLock<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${BACKUP_KEYS_ADVISORY_LOCK_KEY})`
    return fn(tx)
  })
}

export async function getBackupEncryptionStatus(): Promise<BackupEncryptionStatus> {
  const [enabledRow, keys, pending] = await Promise.all([
    prisma.setting.findUnique({ where: { key: ENABLED_KEY } }),
    readKeys(),
    readPending(),
  ])
  return {
    enabled: enabledRow?.value === 'true' && keys.length > 0,
    currentKey: keys[0] ? publicKey(keys[0]) : null,
    pendingKey: pending ? publicKey(pending) : null,
    keys: keys.map(publicKey),
  }
}

/**
 * The recipient a new backup is encrypted to, or null when encryption is
 * off. Throws when it's on without a key — the backup must fail rather than
 * fall back to plaintext.
 */
export async function backupEncryptionRecipient(): Promise<string | null> {
  const enabledRow = await prisma.setting.findUnique({ where: { key: ENABLED_KEY } })
  if (enabledRow?.value !== 'true') return null
  const [current] = await readKeys()
  if (!current) throw new BackupEncryptionError('backupKeyMissing')
  return current.id
}

/** The public ids of every key this server can decrypt with. */
export async function heldKeyIds(): Promise<string[]> {
  return (await readKeys()).map((k) => k.id)
}

/**
 * Generates a new key as the PENDING one (replacing an earlier pending key):
 * new backups keep using the current key until the admin confirms saving
 * the new key's kit (setBackupEncryptionEnabled(true)).
 */
export async function generateBackupKey(now = new Date()): Promise<BackupKey> {
  const identity = await generateX25519Identity()
  const key: StoredKey = { identity, id: await identityToRecipient(identity), createdAt: now.toISOString() }
  await withKeysLock((tx) => writeSetting(tx, PENDING_KEY, JSON.stringify(key)))
  return publicKey(key)
}

/**
 * Turning on (the admin confirmed the kit is saved) promotes a pending key
 * to the current one — older keys are kept — and enables encryption.
 * Turning off keeps every key.
 */
export async function setBackupEncryptionEnabled(enabled: boolean): Promise<void> {
  await withKeysLock(async (tx) => {
    if (enabled) {
      const [keys, pending] = await Promise.all([readKeys(tx), readPending(tx)])
      if (pending) {
        await writeSetting(tx, KEYS_KEY, JSON.stringify([pending, ...keys.filter((k) => k.id !== pending.id)]))
        await tx.setting.deleteMany({ where: { key: PENDING_KEY } })
      } else if (keys.length === 0) {
        throw new BackupEncryptionError('backupKeyMissing')
      }
    }
    await writeSetting(tx, ENABLED_KEY, String(enabled))
  })
}

/**
 * Remembers an identity that decrypted a backup. `makeCurrent` (a fresh
 * install restored from an encrypted backup) also makes it the key new
 * backups use and turns encryption on, so the restored server keeps
 * producing backups the same emergency kit opens — the admin already has it.
 */
async function adoptBackupIdentity(
  identity: string,
  options: { makeCurrent: boolean },
  now = new Date()
): Promise<void> {
  const id = await identityToRecipient(identity)
  await withKeysLock(async (tx) => {
    const keys = await readKeys(tx)
    const existing = keys.find((k) => k.identity === identity)
    const key = existing ?? { identity, id, createdAt: now.toISOString() }
    const others = keys.filter((k) => k.identity !== identity)
    if (options.makeCurrent) {
      await writeSetting(tx, KEYS_KEY, JSON.stringify([key, ...others]))
      await writeSetting(tx, ENABLED_KEY, 'true')
    } else if (!existing) {
      await writeSetting(tx, KEYS_KEY, JSON.stringify([...keys, key]))
    }
  })
}

/**
 * One stored or pending key (by its public id) with its secret identity, for
 * the emergency kit. Without `id`: the pending key, else the current one.
 */
export async function backupKeyForKit(id?: string): Promise<StoredKey> {
  const [keys, pending] = await Promise.all([readKeys(), readPending()])
  const key = id ? [pending, ...keys].find((k) => k?.id === id) : (pending ?? keys[0])
  if (!key) throw new BackupEncryptionError('backupKeyMissing', 404)
  return key
}

// What an admin pasted or uploaded to unlock a backup: an emergency kit (or
// a bare AGE-SECRET-KEY-1… line), or an encrypted export's passphrase.
interface KeyInput {
  identities: string[]
  passphrase: string | null
}

export function parseKeyInput(text: string | undefined | null): KeyInput {
  const trimmed = (text ?? '').trim()
  const identities = [...new Set(trimmed.toUpperCase().match(IDENTITY_PATTERN) ?? [])]
  return { identities, passphrase: identities.length === 0 && trimmed ? trimmed : null }
}

async function isAgeEncrypted(file: string): Promise<boolean> {
  const handle = await fsp.open(file, 'r')
  try {
    const buf = Buffer.alloc(AGE_MAGIC.length)
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0)
    return bytesRead === buf.length && buf.equals(AGE_MAGIC)
  } finally {
    await handle.close()
  }
}

type DecryptionKey = { identity: string } | { passphrase: string }

function toWeb(stream: Readable): ReadableStream<Uint8Array> {
  return Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>
}

function fromWeb(stream: ReadableStream<Uint8Array>): Readable {
  return Readable.fromWeb(stream as unknown as NodeWebReadableStream<Uint8Array>)
}

function decrypterFor(key: DecryptionKey): Decrypter {
  const decrypter = new Decrypter()
  if ('identity' in key) decrypter.addIdentity(key.identity)
  else decrypter.addPassphrase(key.passphrase)
  return decrypter
}

// age authenticates the whole header before decrypt() resolves, so this
// checks a key without reading past the header.
async function opensHeader(file: string, key: DecryptionKey): Promise<boolean> {
  const source = fs.createReadStream(file)
  try {
    const plaintext = await decrypterFor(key).decrypt(toWeb(source))
    await plaintext.cancel().catch(() => {})
    return true
  } catch {
    return false
  } finally {
    source.destroy()
  }
}

/**
 * The key for a backup about to be restored, checked against its header:
 * null for a plaintext zip, else the admin's input (kit or passphrase) or a
 * stored key that opens it. Throws backupKeyRequired/backupKeyMismatch.
 */
export async function resolveRestoreKey(file: string, keyText?: string): Promise<DecryptionKey | null> {
  if (!(await isAgeEncrypted(file))) return null
  const input = parseKeyInput(keyText)
  const stored = (await readKeys()).map((k) => k.identity)
  const candidates: DecryptionKey[] = [
    ...input.identities.map((identity) => ({ identity })),
    ...(input.passphrase ? [{ passphrase: input.passphrase }] : []),
    ...stored.filter((s) => !input.identities.includes(s)).map((identity) => ({ identity })),
  ]
  for (const key of candidates) {
    if (await opensHeader(file, key)) return key
  }
  throw new BackupEncryptionError(
    input.identities.length > 0 || input.passphrase ? 'backupKeyMismatch' : 'backupKeyRequired'
  )
}

/**
 * The plain zip to restore: `file` itself, or — with a key — `file`
 * decrypted into `workDir` (authenticated: a tampered file fails as an
 * invalid archive).
 */
export async function decryptForRestore(file: string, key: DecryptionKey | null, workDir: string): Promise<string> {
  if (!key) return file
  const dest = path.join(workDir, 'decrypted.zip')
  try {
    const plaintext = await decrypterFor(key).decrypt(toWeb(fs.createReadStream(file)))
    await pipeline(fromWeb(plaintext), fs.createWriteStream(dest))
  } catch {
    await fsp.rm(dest, { force: true })
    throw new RestoreError('invalidArchive', 'Decrypting the backup failed')
  }
  return dest
}

/** After a restore: keep the identity of an emergency kit that opened the backup. */
export async function keepRestoreKey(key: DecryptionKey | null, makeCurrent: boolean): Promise<void> {
  if (key && 'identity' in key) await adoptBackupIdentity(key.identity, { makeCurrent })
}

/** Encrypts a plaintext stream to a backup key (`age1…`) or a passphrase. */
export async function encryptStream(
  plaintext: Readable,
  to: { recipient: string } | { passphrase: string }
): Promise<Readable> {
  const encrypter = new Encrypter()
  if ('recipient' in to) encrypter.addRecipient(to.recipient)
  else encrypter.setPassphrase(to.passphrase)
  return fromWeb(await encrypter.encrypt(toWeb(plaintext)))
}

/**
 * The emergency kit: an age identity file (`#` lines are comments, so
 * `age -d -i kit.txt backup.zip.age` reads it as is) with instructions.
 */
export function emergencyKitText(key: StoredKey, instanceName: string, t: (key: string) => string): string {
  return [
    `# ${t('backupKit.title')}`,
    '#',
    `# ${t('backupKit.instance')}: ${instanceName}`,
    `# ${t('backupKit.created')}: ${key.createdAt}`,
    `# ${t('backupKit.publicKey')}: ${key.id}`,
    '#',
    ...t('backupKit.body')
      .split('\n')
      .map((l) => (l ? `# ${l}` : '#')),
    '#',
    '#   age -d -i famlin-emergency-kit.txt famlin-backup-<date>.zip.age > famlin-backup.zip',
    '',
    key.identity,
    '',
  ].join('\n')
}
