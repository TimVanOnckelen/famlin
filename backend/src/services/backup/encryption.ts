import fs from 'fs'
import fsp from 'fs/promises'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import type { ReadableStream as NodeWebReadableStream } from 'stream/web'
import { Decrypter, Encrypter, generateX25519Identity, identityToRecipient } from 'age-encryption'
import { prisma } from '../../db.js'

// Encrypted backups (issue #495), modelled on Home Assistant's: the server
// generates an age X25519 identity and keeps it, so scheduled backups run
// unattended; the admin keeps a copy (the "emergency kit") somewhere else.
// The threat model is copies that LEAVE the server (off-site sync, a
// downloaded file) — whoever controls the server can read its key.
//
// Both rows are deliberately outside ServerSettings/SETTING_KEYS (like
// `updateCheckResult`): the generic settings GET/PATCH never see them, the
// export never carries them, and a restore onto a running server
// (wipeForRestore) leaves them alone. The identities only ever leave the
// server through the emergency-kit download.
const ENABLED_KEY = 'backupEncryptionEnabled'
const KEYS_KEY = 'backupEncryptionKeys'

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
  // The key new backups are encrypted with; null until one is generated.
  currentKey: BackupKey | null
  // Every key this server can still decrypt with, newest first.
  keys: BackupKey[]
}

export class BackupEncryptionError extends Error {
  constructor(readonly code: 'noKey' | 'unknownKey') {
    super(code)
    this.name = 'BackupEncryptionError'
  }
}

function publicKey({ id, createdAt }: StoredKey): BackupKey {
  return { id, createdAt }
}

async function readKeys(): Promise<StoredKey[]> {
  const row = await prisma.setting.findUnique({ where: { key: KEYS_KEY } })
  if (!row) return []
  try {
    const parsed = JSON.parse(row.value) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (k): k is StoredKey =>
        !!k && typeof k.identity === 'string' && typeof k.id === 'string' && typeof k.createdAt === 'string'
    )
  } catch {
    return []
  }
}

async function writeKeys(keys: StoredKey[]): Promise<void> {
  const value = JSON.stringify(keys)
  await prisma.setting.upsert({ where: { key: KEYS_KEY }, create: { key: KEYS_KEY, value }, update: { value } })
}

async function writeEnabled(enabled: boolean): Promise<void> {
  const value = String(enabled)
  await prisma.setting.upsert({ where: { key: ENABLED_KEY }, create: { key: ENABLED_KEY, value }, update: { value } })
}

export async function getBackupEncryptionStatus(): Promise<BackupEncryptionStatus> {
  const [enabledRow, keys] = await Promise.all([prisma.setting.findUnique({ where: { key: ENABLED_KEY } }), readKeys()])
  return {
    enabled: enabledRow?.value === 'true' && keys.length > 0,
    currentKey: keys[0] ? publicKey(keys[0]) : null,
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
  if (!current) throw new BackupEncryptionError('noKey')
  return current.id
}

/** Every identity this server holds, newest first. */
export async function storedBackupIdentities(): Promise<string[]> {
  return (await readKeys()).map((k) => k.identity)
}

/** Generates a new key and makes it the current one; older keys are kept. */
export async function generateBackupKey(now = new Date()): Promise<BackupKey> {
  const identity = await generateX25519Identity()
  const key: StoredKey = { identity, id: await identityToRecipient(identity), createdAt: now.toISOString() }
  await writeKeys([key, ...(await readKeys())])
  return publicKey(key)
}

export async function setBackupEncryptionEnabled(enabled: boolean): Promise<void> {
  if (enabled && (await readKeys()).length === 0) throw new BackupEncryptionError('noKey')
  await writeEnabled(enabled)
}

/**
 * Remembers an identity that decrypted a backup. `makeCurrent` (a fresh
 * install restored from an encrypted backup) also makes it the key new
 * backups use and turns encryption on, so the restored server keeps
 * producing backups the same emergency kit opens.
 */
export async function adoptBackupIdentity(
  identity: string,
  options: { makeCurrent: boolean },
  now = new Date()
): Promise<void> {
  const keys = await readKeys()
  const existing = keys.find((k) => k.identity === identity)
  const key = existing ?? { identity, id: await identityToRecipient(identity), createdAt: now.toISOString() }
  const others = keys.filter((k) => k.identity !== identity)
  await writeKeys(options.makeCurrent ? [key, ...others] : existing ? keys : [...keys, key])
  if (options.makeCurrent) await writeEnabled(true)
}

/** The secret identity of one stored key (by its public id), for the emergency kit. */
export async function backupIdentityFor(id: string): Promise<string> {
  const key = (await readKeys()).find((k) => k.id === id)
  if (!key) throw new BackupEncryptionError('unknownKey')
  return key.identity
}

// What an admin pasted or uploaded to unlock a backup: an emergency kit (or
// a bare AGE-SECRET-KEY-1… line), or — for a passphrase-protected export —
// the passphrase itself.
export interface KeyInput {
  identities: string[]
  passphrase: string | null
}

export function parseKeyInput(text: string | undefined | null): KeyInput {
  const trimmed = (text ?? '').trim()
  const identities = [...new Set(trimmed.toUpperCase().match(IDENTITY_PATTERN) ?? [])]
  return { identities, passphrase: identities.length === 0 && trimmed ? trimmed : null }
}

/** Whether `file` is an age-encrypted file, from its first bytes. */
export async function isAgeEncrypted(file: string): Promise<boolean> {
  const handle = await fsp.open(file, 'r')
  try {
    const buf = Buffer.alloc(AGE_MAGIC.length)
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0)
    return bytesRead === buf.length && buf.equals(AGE_MAGIC)
  } finally {
    await handle.close()
  }
}

export type DecryptionKey = { identity: string } | { passphrase: string }

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

// age processes (and authenticates) the whole header before decrypt()
// resolves, so this checks a key against a multi-GB file without reading
// past the header.
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
 * The first candidate that opens `file` — the admin's own input first, then
 * every key this server holds — or null when none does.
 */
export async function findDecryptionKey(
  file: string,
  input: KeyInput,
  stored: string[]
): Promise<DecryptionKey | null> {
  const candidates: DecryptionKey[] = [
    ...input.identities.map((identity) => ({ identity })),
    ...(input.passphrase ? [{ passphrase: input.passphrase }] : []),
    ...stored.filter((s) => !input.identities.includes(s)).map((identity) => ({ identity })),
  ]
  for (const key of candidates) {
    if (await opensHeader(file, key)) return key
  }
  return null
}

/** Decrypts `src` into `dest` (authenticated: a tampered file fails, and `dest` is removed). */
export async function decryptFile(src: string, dest: string, key: DecryptionKey): Promise<void> {
  try {
    const plaintext = await decrypterFor(key).decrypt(toWeb(fs.createReadStream(src)))
    await pipeline(fromWeb(plaintext), fs.createWriteStream(dest))
  } catch (err) {
    await fsp.rm(dest, { force: true })
    throw err
  }
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
 * The emergency kit: an age identity file (comment lines start with `#`, so
 * `age -d -i kit.txt backup.zip.age` reads it as is) with instructions.
 */
export function emergencyKitText(
  key: { id: string; createdAt: string; identity: string },
  instanceName: string,
  lines: { title: string; instance: string; created: string; publicKey: string; body: string[] }
): string {
  return [
    `# ${lines.title}`,
    '#',
    `# ${lines.instance}: ${instanceName}`,
    `# ${lines.created}: ${key.createdAt}`,
    `# ${lines.publicKey}: ${key.id}`,
    '#',
    ...lines.body.map((l) => (l ? `# ${l}` : '#')),
    '#',
    '#   age -d -i famlin-emergency-kit.txt famlin-backup-<date>.zip.age > famlin-backup.zip',
    '',
    key.identity,
    '',
  ].join('\n')
}

export class BackupKeyError extends Error {
  // keyRequired: encrypted, and no key this server holds opens it — ask the
  // admin for the emergency kit. keyMismatch: the key they gave doesn't
  // either.
  constructor(readonly code: 'keyRequired' | 'keyMismatch') {
    super(code)
    this.name = 'BackupKeyError'
  }
}

/**
 * Finds the key for a backup about to be restored, without decrypting it
 * yet: null for a plaintext zip, the key for an encrypted one, or
 * BackupKeyError when neither the admin's input nor a stored key opens it.
 */
export async function resolveRestoreKey(file: string, input: KeyInput): Promise<DecryptionKey | null> {
  if (!(await isAgeEncrypted(file))) return null
  const key = await findDecryptionKey(file, input, await storedBackupIdentities())
  if (key) return key
  throw new BackupKeyError(input.identities.length > 0 || input.passphrase ? 'keyMismatch' : 'keyRequired')
}
