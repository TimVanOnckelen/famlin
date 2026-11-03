import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import fsp from 'fs/promises'
import os from 'os'
import path from 'path'
import { buildTestApp } from './helpers.js'

// Regression: every @fastify/static registration uses decorateReply: false, so
// reply.sendFile() doesn't exist — /admin and the admin SPA fallback used to
// call it and 500'd ("reply.sendFile is not a function") once the /uploads/
// static registration (the only one that decorated reply) was removed.
describe('SPA serving (admin + web builds present)', () => {
  let app: FastifyInstance
  let root: string

  beforeAll(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), 'famlin-spa-'))
    await fsp.mkdir(path.join(root, 'dist', 'admin'), { recursive: true })
    await fsp.mkdir(path.join(root, 'dist', 'web'), { recursive: true })
    await fsp.writeFile(path.join(root, 'dist', 'admin', 'index.html'), '<html><body>admin-spa</body></html>')
    await fsp.writeFile(path.join(root, 'dist', 'admin', 'app.js'), 'console.log("admin")')
    await fsp.writeFile(
      path.join(root, 'dist', 'web', 'index.html'),
      '<html><head><title>Famlin</title></head><body>web-spa</body></html>'
    )
    const realCwd = process.cwd()
    const spy = vi.spyOn(process, 'cwd').mockReturnValue(root)
    try {
      app = await buildTestApp()
    } finally {
      spy.mockRestore()
      expect(process.cwd()).toBe(realCwd)
    }
  })

  afterAll(async () => {
    await app?.close()
    await fsp.rm(root, { recursive: true, force: true })
  })

  it('redirects /admin to /admin/ and preserves query parameters', async () => {
    for (const method of ['GET', 'HEAD'] as const) {
      for (const query of ['', '?code=test&state=test%2Bstate']) {
        const res = await app.inject({ method, url: `/admin${query}` })
        expect(res.statusCode).toBe(302)
        expect(res.headers.location).toBe(`/admin/${query}`)
      }
    }
  })

  it('serves the admin index at /admin/', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
    expect(res.body).toContain('admin-spa')
  })

  it('falls back to the admin index for client-side admin routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/users/123' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('admin-spa')
  })

  it('still serves real admin static files', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/app.js' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('console.log("admin")')
  })

  it('serves the web index at / and for client-side routes', async () => {
    for (const url of ['/', '/posts/abc']) {
      const res = await app.inject({ method: 'GET', url })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('web-spa')
    }
  })
})
