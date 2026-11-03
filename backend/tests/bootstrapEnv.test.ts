import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyBootstrapEnv, deriveDatabaseUrl, resolveJwtSecret } from '../src/bootstrapEnv.js'

describe('zero-config bootstrap env', () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'famlin-bootstrap-'))
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  const file = () => path.join(dir, 'secrets', 'jwt_secret')

  it('lets an explicit JWT_SECRET win and writes nothing', () => {
    expect(resolveJwtSecret({ JWT_SECRET: 'x'.repeat(40) }, dir)).toBe('x'.repeat(40))
    expect(fs.existsSync(file())).toBe(false)
  })

  it('generates and persists a secret (mode 0600), logging without the value', () => {
    const logs: string[] = []
    const secret = resolveJwtSecret({}, dir, (m) => logs.push(m))
    expect(secret.length).toBeGreaterThanOrEqual(32)
    expect(fs.readFileSync(file(), 'utf8')).toBe(secret)
    expect(fs.statSync(file()).mode & 0o777).toBe(0o600)
    expect(logs).toHaveLength(1)
    expect(logs[0]).toContain(file())
    expect(logs[0]).not.toContain(secret)
  })

  it('reuses an existing secret file on later boots', () => {
    const first = resolveJwtSecret({}, dir, () => {})
    const logs: string[] = []
    expect(resolveJwtSecret({}, dir, (m) => logs.push(m))).toBe(first)
    expect(logs).toHaveLength(0)
  })

  it('treats an empty JWT_SECRET as unset', () => {
    const env: Record<string, string | undefined> = { JWT_SECRET: '', DATA_DIR: dir }
    applyBootstrapEnv(env)
    expect(env.JWT_SECRET!.length).toBeGreaterThanOrEqual(32)
  })

  it('derives DATABASE_URL from POSTGRES_* with an encoded password', () => {
    expect(deriveDatabaseUrl({ POSTGRES_PASSWORD: 'p@ss/w:rd' })).toBe(
      'postgresql://famlin:p%40ss%2Fw%3Ard@famlin-db:5432/famlin?schema=public'
    )
  })

  it('reads the password from POSTGRES_PASSWORD_FILE and honours host/port', () => {
    const pw = path.join(dir, 'pw')
    fs.writeFileSync(pw, 'secret\n')
    expect(deriveDatabaseUrl({ POSTGRES_PASSWORD_FILE: pw, POSTGRES_HOST: 'db', POSTGRES_PORT: '6543' })).toBe(
      'postgresql://famlin:secret@db:6543/famlin?schema=public'
    )
  })

  it('never overrides an explicit DATABASE_URL', () => {
    const env: Record<string, string | undefined> = {
      DATABASE_URL: 'postgresql://a:b@h/d',
      POSTGRES_PASSWORD: 'zzz',
      JWT_SECRET: 'x'.repeat(32),
    }
    applyBootstrapEnv(env)
    expect(env.DATABASE_URL).toBe('postgresql://a:b@h/d')
  })

  it('returns undefined without any password', () => {
    expect(deriveDatabaseUrl({})).toBeUndefined()
  })
})

describe('resolveJwtSecret failure modes', () => {
  it('throws a descriptive error when the data dir is not writable', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'famlin-bootstrap-'))
    const blocker = path.join(base, 'blocker')
    fs.writeFileSync(blocker, 'x') // a file where the directory should be: mkdir fails
    try {
      expect(() => resolveJwtSecret({}, blocker, () => {})).toThrow(/set JWT_SECRET or make DATA_DIR/)
    } finally {
      fs.rmSync(base, { recursive: true, force: true })
    }
  })

  it('waits for a concurrently created, still-empty secret file', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'famlin-bootstrap-'))
    const file = path.join(base, 'secrets', 'jwt_secret')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, '') // empty: the other process hasn't written yet
    // readFileSync of an empty file reads as "missing", so the first read
    // misses and the exclusive create hits EEXIST; fill it mid-retry.
    const timer = setTimeout(() => {}, 0)
    clearTimeout(timer)
    const realRead = fs.readFileSync
    let reads = 0
    const spy = (p: any, ...rest: any[]) => {
      if (String(p) === file && ++reads === 3) fs.writeFileSync(file, 'winner-secret')
      return (realRead as any)(p, ...rest)
    }
    ;(fs as any).readFileSync = spy
    try {
      expect(resolveJwtSecret({}, base, () => {})).toBe('winner-secret')
    } finally {
      ;(fs as any).readFileSync = realRead
      fs.rmSync(base, { recursive: true, force: true })
    }
  })
})
