import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildTestApp } from './helpers.js'
import { updateSettings } from '../src/services/settings.js'

describe('GET /connect (mobile app connect landing page)', () => {
  let root: string
  let app: FastifyInstance
  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'famlin-connect-test-'))
    await fs.mkdir(path.join(root, 'dist', 'web'), { recursive: true })
    await fs.writeFile(
      path.join(root, 'dist', 'web', 'index.html'),
      '<!doctype html><html><body><div id="root">spa-fixture</div></body></html>'
    )
    // With the SPA served, /connect must still reach this route instead of
    // falling through to the SPA's index.html not-found fallback.
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(root)
    try {
      app = await buildTestApp()
    } finally {
      cwd.mockRestore()
    }
  })
  afterAll(async () => {
    await updateSettings({ defaultLanguage: 'en' })
    if (app) await app.close()
    if (root) await fs.rm(root, { recursive: true, force: true })
  })

  it('serves the landing page with the encoded deep link and server address', async () => {
    const res = await app.inject({ method: 'GET', url: '/connect', headers: { host: 'famlin.example.com:8443' } })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
    expect(res.body).toContain(`famlin://connect?server=${encodeURIComponent('http://famlin.example.com:8443')}`)
    expect(res.body).toContain('http://famlin.example.com:8443')
    expect(res.body).not.toContain('spa-fixture')
  })

  it('is translated into the server default language', async () => {
    await updateSettings({ defaultLanguage: 'nl' })
    const res = await app.inject({ method: 'GET', url: '/connect' })
    expect(res.body).toContain('Openen in de Famlin-app')
  })
})
