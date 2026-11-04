import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import crypto from 'crypto'
import type { FastifyInstance } from 'fastify'
import { buildTestApp, createUser, authHeader, createGroup, addMember } from './helpers.js'
import { prisma } from '../src/db.js'
import { canReadUpload, recordUpload } from '../src/services/uploads.js'
import { wikiExcerpt } from '../src/services/wiki.js'

// Family Wiki (issue #118): one wiki per family, editable by every member who
// can see a page, optionally narrowed to a circle exactly like posts.

let app: FastifyInstance
type User = Awaited<ReturnType<typeof createUser>>
let author: User
let member: User
let outsider: User // in the family, not in the circle
let stranger: User // not in the family at all
let admin: User
let group: { id: string }
let otherGroup: { id: string }
let circle: { id: string }

beforeAll(async () => {
  app = await buildTestApp()
  author = await createUser({ name: 'Author' })
  member = await createUser({ name: 'Member' })
  outsider = await createUser({ name: 'Outsider' })
  stranger = await createUser({ name: 'Stranger' })
  admin = await createUser({ name: 'Admin', isAdmin: true })
  group = await createGroup({ name: 'Wiki family' })
  otherGroup = await createGroup({ name: 'Other family' })
  for (const u of [author, member, outsider, admin]) await addMember(group.id, u.id)
  await addMember(otherGroup.id, stranger.id)
  circle = await prisma.circle.create({
    data: {
      groupId: group.id,
      name: 'Parents',
      members: { create: [{ userId: author.id }, { userId: member.id }] },
    },
  })
})

afterAll(async () => {
  await app.close()
})

async function createPage(user: User, body: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: '/api/wiki/pages',
    headers: authHeader(user),
    payload: { groupId: group.id, ...body },
  })
}

async function list(user: User, query = '') {
  return app.inject({ method: 'GET', url: `/api/wiki/pages?groupId=${group.id}${query}`, headers: authHeader(user) })
}

describe('Family Wiki', () => {
  it('creates, reads, lists and searches pages', async () => {
    const res = await createPage(author, {
      title: "Grandma's lasagna",
      emoji: '🍝',
      category: 'Recipes',
      content: '## Ingredients\n- **pasta** sheets\n- [ ] buy ricotta',
    })
    expect(res.statusCode).toBe(201)
    const page = res.json()
    expect(page).toMatchObject({
      title: "Grandma's lasagna",
      emoji: '🍝',
      category: 'Recipes',
      locked: false,
      circle: null,
      canEdit: true,
      canManage: true,
      createdBy: { id: author.id, name: 'Author' },
    })
    expect(page.excerpt).toBe('Ingredients pasta sheets buy ricotta')

    await createPage(member, { title: 'Holiday house Wi-Fi', category: 'Holiday house', content: 'Password: tomato' })
    await createPage(member, { title: 'Uncategorized note', content: '' })

    const all = (await list(member)).json()
    expect(all.items.map((p: { title: string }) => p.title)).toEqual([
      'Uncategorized note',
      'Holiday house Wi-Fi',
      "Grandma's lasagna",
    ])
    expect(all.items[0]).not.toHaveProperty('content')

    // Search covers content, case-insensitively.
    const found = (await list(member, '&q=TOMATO')).json()
    expect(found.items.map((p: { title: string }) => p.title)).toEqual(['Holiday house Wi-Fi'])

    // Category filter, '' = uncategorized.
    const recipes = (await list(member, '&category=recipes')).json()
    expect(recipes.items).toHaveLength(1)
    const none = (await list(member, '&category=')).json()
    expect(none.items.map((p: { title: string }) => p.title)).toEqual(['Uncategorized note'])

    const cats = await app.inject({
      method: 'GET',
      url: `/api/wiki/categories?groupId=${group.id}`,
      headers: authHeader(member),
    })
    expect(cats.json().items).toEqual([
      { name: 'Holiday house', pageCount: 1 },
      { name: 'Recipes', pageCount: 1 },
      { name: null, pageCount: 1 },
    ])

    const detail = await app.inject({ method: 'GET', url: `/api/wiki/pages/${page.id}`, headers: authHeader(member) })
    expect(detail.statusCode).toBe(200)
    expect(detail.json()).toMatchObject({ content: page.content, canEdit: true, canManage: false })
  })

  it('keeps other families out', async () => {
    const page = (await createPage(author, { title: 'Family only' })).json()
    expect((await list(stranger)).statusCode).toBe(403)
    const res = await app.inject({ method: 'GET', url: `/api/wiki/pages/${page.id}`, headers: authHeader(stranger) })
    expect(res.statusCode).toBe(404)
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/wiki/pages/${page.id}`,
      headers: authHeader(stranger),
      payload: { title: 'Hijacked' },
    })
    expect(patch.statusCode).toBe(404)
    const create = await app.inject({
      method: 'POST',
      url: '/api/wiki/pages',
      headers: authHeader(stranger),
      payload: { groupId: group.id, title: 'Nope' },
    })
    expect(create.statusCode).toBe(403)
  })

  it('hides circle-private pages from family members outside the circle', async () => {
    const res = await createPage(author, { title: 'Surprise party plan', circleId: circle.id, category: 'Secret' })
    expect(res.statusCode).toBe(201)
    const page = res.json()
    expect(page.circle).toEqual({ id: circle.id, name: 'Parents' })

    expect((await list(member)).json().items.map((p: { id: string }) => p.id)).toContain(page.id)
    const outsiderList = (await list(outsider)).json()
    expect(outsiderList.items.map((p: { id: string }) => p.id)).not.toContain(page.id)
    expect((await list(outsider, '&q=surprise')).json().items).toEqual([])
    const cats = await app.inject({
      method: 'GET',
      url: `/api/wiki/categories?groupId=${group.id}`,
      headers: authHeader(outsider),
    })
    expect(cats.json().items.map((c: { name: string }) => c.name)).not.toContain('Secret')

    for (const method of ['GET', 'PATCH', 'DELETE'] as const) {
      const r = await app.inject({
        method,
        url: `/api/wiki/pages/${page.id}`,
        headers: authHeader(outsider),
        ...(method === 'PATCH' ? { payload: { title: 'x' } } : {}),
      })
      expect(r.statusCode).toBe(404)
    }

    // ...and a non-member can't target the circle.
    expect((await createPage(outsider, { title: 'x', circleId: circle.id })).statusCode).toBe(403)
  })

  it('lets any member edit, but only creator/admin lock, unlock or delete', async () => {
    const page = (await createPage(author, { title: 'Traditions', content: 'v1' })).json()

    const edit = await app.inject({
      method: 'PATCH',
      url: `/api/wiki/pages/${page.id}`,
      headers: authHeader(member),
      payload: { content: 'v2', category: 'Traditions' },
    })
    expect(edit.statusCode).toBe(200)
    expect(edit.json()).toMatchObject({ content: 'v2', category: 'Traditions', updatedBy: { id: member.id } })

    const lockByMember = await app.inject({
      method: 'PATCH',
      url: `/api/wiki/pages/${page.id}`,
      headers: authHeader(member),
      payload: { locked: true },
    })
    expect(lockByMember.statusCode).toBe(403)

    const lock = await app.inject({
      method: 'PATCH',
      url: `/api/wiki/pages/${page.id}`,
      headers: authHeader(author),
      payload: { locked: true },
    })
    expect(lock.statusCode).toBe(200)

    const lockedEdit = await app.inject({
      method: 'PATCH',
      url: `/api/wiki/pages/${page.id}`,
      headers: authHeader(member),
      payload: { content: 'v3' },
    })
    expect(lockedEdit.statusCode).toBe(403)
    const detail = await app.inject({ method: 'GET', url: `/api/wiki/pages/${page.id}`, headers: authHeader(member) })
    expect(detail.json()).toMatchObject({ locked: true, canEdit: false, canManage: false })

    const adminEdit = await app.inject({
      method: 'PATCH',
      url: `/api/wiki/pages/${page.id}`,
      headers: authHeader(admin),
      payload: { content: 'v3' },
    })
    expect(adminEdit.statusCode).toBe(200)

    const memberDelete = await app.inject({
      method: 'DELETE',
      url: `/api/wiki/pages/${page.id}`,
      headers: authHeader(member),
    })
    expect(memberDelete.statusCode).toBe(403)
    const del = await app.inject({ method: 'DELETE', url: `/api/wiki/pages/${page.id}`, headers: authHeader(author) })
    expect(del.statusCode).toBe(200)
    expect(await prisma.wikiPage.findUnique({ where: { id: page.id } })).toBeNull()
  })

  it('rejects a save based on an outdated version', async () => {
    const page = (await createPage(author, { title: 'Pets', content: 'Feed the cat' })).json()
    const first = await app.inject({
      method: 'PATCH',
      url: `/api/wiki/pages/${page.id}`,
      headers: authHeader(member),
      payload: { content: 'Feed the cat twice', baseUpdatedAt: page.updatedAt },
    })
    expect(first.statusCode).toBe(200)

    const stale = await app.inject({
      method: 'PATCH',
      url: `/api/wiki/pages/${page.id}`,
      headers: authHeader(author),
      payload: { content: 'Feed the dog', baseUpdatedAt: page.updatedAt },
    })
    expect(stale.statusCode).toBe(409)
    expect(stale.json().page.content).toBe('Feed the cat twice')
  })

  it("binds embedded photos to the page's audience", async () => {
    const familyPhoto = `/uploads/${crypto.randomUUID()}.jpg`
    const circlePhoto = `/uploads/${crypto.randomUUID()}.jpg`
    await recordUpload(familyPhoto, author.id)
    await recordUpload(circlePhoto, author.id)
    // Unbound: only the uploader can read it.
    expect(await canReadUpload(familyPhoto, member.id)).toBe(false)

    await createPage(author, { title: 'Album', content: `![the house](${familyPhoto})` })
    expect(await canReadUpload(familyPhoto, outsider.id)).toBe(true)
    expect(await canReadUpload(familyPhoto, stranger.id)).toBe(false)

    const page = (await createPage(author, { title: 'Private', circleId: circle.id, content: '' })).json()
    await app.inject({
      method: 'PATCH',
      url: `/api/wiki/pages/${page.id}`,
      headers: authHeader(author),
      payload: { content: `![secret](${circlePhoto})` },
    })
    expect(await canReadUpload(circlePhoto, member.id)).toBe(true)
    expect(await canReadUpload(circlePhoto, outsider.id)).toBe(false)
  })

  it("survives its author's deletion and dies with its circle", async () => {
    const leaver = await createUser({ name: 'Leaver' })
    await addMember(group.id, leaver.id)
    const page = (await createPage(leaver, { title: 'Family history' })).json()
    await prisma.user.delete({ where: { id: leaver.id } })
    const kept = await prisma.wikiPage.findUnique({ where: { id: page.id } })
    expect(kept).toMatchObject({ createdById: null, updatedById: null })

    const doomedCircle = await prisma.circle.create({
      data: { groupId: group.id, name: 'Temp', members: { create: [{ userId: admin.id }] } },
    })
    const secret = (await createPage(admin, { title: 'Temp page', circleId: doomedCircle.id })).json()
    const blocked = await app.inject({
      method: 'DELETE',
      url: `/api/admin/circles/${doomedCircle.id}`,
      headers: authHeader(admin),
    })
    expect(blocked.statusCode).toBe(409)
    expect(blocked.json()).toMatchObject({ postCount: 0, wikiPageCount: 1 })
    const ok = await app.inject({
      method: 'DELETE',
      url: `/api/admin/circles/${doomedCircle.id}?deleteContent=true`,
      headers: authHeader(admin),
    })
    expect(ok.statusCode).toBe(200)
    expect(await prisma.wikiPage.findUnique({ where: { id: secret.id } })).toBeNull()
  })

  it('validates input', async () => {
    expect((await createPage(author, { title: '' })).statusCode).toBe(400)
    expect((await createPage(author, { title: 'x'.repeat(121) })).statusCode).toBe(400)
  })
})

describe('wikiExcerpt', () => {
  it('strips Markdown and truncates', () => {
    expect(wikiExcerpt('# Title\n\n> quote with [a link](https://x.y) and ![img](/uploads/a.jpg)')).toBe(
      'Title quote with a link and'
    )
    expect(wikiExcerpt('a'.repeat(200), 10)).toBe('aaaaaaaaa…')
  })
})
