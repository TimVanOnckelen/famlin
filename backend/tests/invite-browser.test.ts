import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { prisma } from '../src/db.js'
import { buildTestApp, createGroup } from './helpers.js'
import { updateSettings } from '../src/services/settings.js'

describe('invitation browser entrypoint', () => {
  let root: string
  let app: FastifyInstance
  let token: string
  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'famlin-web-invite-test-'))
    await fs.mkdir(path.join(root, 'dist', 'web'), { recursive: true })
    await fs.writeFile(
      path.join(root, 'dist', 'web', 'index.html'),
      '<!doctype html><html><head><title>Famlin</title></head><body><div id="root">web-join-fixture</div></body></html>'
    )
    // Serve a disposable SPA fixture, independent of any local production build.
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(root)
    try {
      app = await buildTestApp()
    } finally {
      cwd.mockRestore()
    }
    const group = await createGroup({ name: 'Browser family' })
    const invite = await prisma.invite.create({ data: { groupId: group.id, token: 'browser-invite-token' } })
    token = invite.token
  })
  afterAll(async () => {
    await updateSettings({ defaultLanguage: 'en' })
    if (app) await app.close()
    if (root) await fs.rm(root, { recursive: true, force: true })
  })
  it.each([
    ['en', 'Continue in the browser'],
    ['nl', 'Doorgaan in de browser'],
    ['zh', '在浏览器中继续'],
  ] as const)('offers the browser hand-off in %s', async (language, label) => {
    await updateSettings({ defaultLanguage: language })
    const response = await app.inject({ method: 'GET', url: `/invite/${token}` })
    expect(response.statusCode).toBe(200)
    expect(response.body).toContain(`href="/join/${token}"`)
    expect(response.body).toContain(label)
    expect(response.body).toContain('famlin://invite/')
    expect(response.body).not.toContain('web-join-fixture')
  })
  it('serves the web SPA at /join without replacing the existing invite landing page', async () => {
    const join = await app.inject({ method: 'GET', url: `/join/${token}` })
    expect(join.statusCode).toBe(200)
    expect(join.headers['content-type']).toContain('text/html')
    expect(join.body).toContain('web-join-fixture')
    const landing = await app.inject({ method: 'GET', url: `/invite/${token}` })
    expect(landing.body).toContain('Browser family')
    expect(landing.body).not.toContain('web-join-fixture')
    const preview = await app.inject({ method: 'GET', url: `/api/invites/${token}` })
    expect(preview.json()).toMatchObject({ status: 'valid', groupName: 'Browser family' })
  })
})
