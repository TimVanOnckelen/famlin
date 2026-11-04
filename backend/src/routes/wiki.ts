import { FastifyInstance } from 'fastify'
import { Prisma } from '@prisma/client'
import { prisma } from '../db.js'
import { requireGroupMember } from '../plugins/auth.js'
import { validateCircleTarget } from '../services/circles.js'
import { bindAssetsToScope } from '../services/uploads.js'
import { paginationArgs, paginate } from '../services/pagination.js'
import {
  canEditWikiPage,
  canManageWikiPage,
  extractUploadPaths,
  findVisibleWikiPage,
  shapeWikiPage,
  shapeWikiPageSummary,
  visibleWikiPagesWhereFor,
  wikiPageInclude,
} from '../services/wiki.js'
import { createWikiPageSchema, updateWikiPageSchema, wikiCategoriesQuerySchema, wikiListQuerySchema } from '../types.js'
import { getT } from '../i18n/index.js'

// Family Wiki (issue #118): durable, editable family knowledge, one wiki per
// family. Every read is filtered through visibleWikiPagesWhere /
// findVisibleWikiPage (services/wiki.ts) — group membership plus the
// optional circle narrowing, exactly like posts.
export default async function wikiRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate)

  // The overview, search and "recently updated" in one list: newest edit
  // first, optionally narrowed by a case-insensitive search over title,
  // category and content, and/or one category ('' = uncategorized).
  fastify.get('/pages', async (request, reply) => {
    const { groupId, q, category, cursor, take } = wikiListQuerySchema.parse(request.query)
    if (await requireGroupMember(request, reply, groupId)) return

    const filters: Prisma.WikiPageWhereInput[] = [await visibleWikiPagesWhereFor([groupId], request.user!.id)]
    if (q) {
      filters.push({
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { category: { contains: q, mode: 'insensitive' } },
          { content: { contains: q, mode: 'insensitive' } },
        ],
      })
    }
    if (category !== undefined) {
      filters.push({ category: category === '' ? null : { equals: category, mode: 'insensitive' } })
    }

    const rows = await prisma.wikiPage.findMany({
      where: { AND: filters },
      include: wikiPageInclude,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      ...paginationArgs({ cursor, take }),
    })
    const { items, nextCursor } = paginate(rows, take)
    return { items: items.map(shapeWikiPageSummary), nextCursor }
  })

  // Every category in use among the pages the caller can see, with counts —
  // the wiki overview's "folders". Uncategorized pages are reported as
  // `name: null`.
  fastify.get('/categories', async (request, reply) => {
    const { groupId } = wikiCategoriesQuerySchema.parse(request.query)
    if (await requireGroupMember(request, reply, groupId)) return

    const groups = await prisma.wikiPage.groupBy({
      by: ['category'],
      where: await visibleWikiPagesWhereFor([groupId], request.user!.id),
      _count: { _all: true },
    })
    // The list filter matches a category case-insensitively, so counts are
    // merged the same way ("Recipes" + "recipes" = one chip), under the
    // spelling most pages use.
    const merged = new Map<string, { name: string | null; pageCount: number; best: number }>()
    for (const g of groups) {
      const key = g.category === null ? '\u0000' : g.category.toLowerCase()
      const entry = merged.get(key)
      const count = g._count._all
      if (!entry) merged.set(key, { name: g.category, pageCount: count, best: count })
      else {
        entry.pageCount += count
        if (count > entry.best) Object.assign(entry, { name: g.category, best: count })
      }
    }
    const items = [...merged.values()]
      .map(({ name, pageCount }) => ({ name, pageCount }))
      .sort((a, b) => {
        if (a.name === null) return 1
        if (b.name === null) return -1
        return a.name.localeCompare(b.name)
      })
    return { items }
  })

  fastify.get('/pages/:pageId', async (request, reply) => {
    const { pageId } = request.params as { pageId: string }
    const page = await findVisibleWikiPage(pageId, request.user!.id)
    if (!page) return reply.status(404).send({ error: getT(request)('errors.wikiPageNotFound') })
    return shapeWikiPage(page, request.user!)
  })

  fastify.post('/pages', async (request, reply) => {
    const t = getT(request)
    const body = createWikiPageSchema.parse(request.body)
    const user = request.user!
    if (await requireGroupMember(request, reply, body.groupId)) return

    // Same collapse-to-one-403 rule as posts and stories: a non-member can't
    // tell "not your circle" from "no such circle".
    const circleId = body.circleId ?? null
    if (circleId && (await validateCircleTarget(circleId, body.groupId, user.id))) {
      return reply.status(403).send({ error: t('errors.notCircleMember') })
    }

    const page = await prisma.wikiPage.create({
      data: {
        groupId: body.groupId,
        circleId,
        title: body.title,
        emoji: body.emoji ?? null,
        category: body.category ?? null,
        content: body.content,
        locked: body.locked ?? false,
        createdById: user.id,
        updatedById: user.id,
      },
      include: wikiPageInclude,
    })
    await bindAssetsToScope(extractUploadPaths(page.content), { groupIds: [page.groupId], circleId }, user.id)

    return reply.status(201).send(shapeWikiPage(page, user))
  })

  fastify.patch('/pages/:pageId', async (request, reply) => {
    const t = getT(request)
    const { pageId } = request.params as { pageId: string }
    const body = updateWikiPageSchema.parse(request.body)
    const user = request.user!

    const page = await findVisibleWikiPage(pageId, user.id)
    if (!page) return reply.status(404).send({ error: t('errors.wikiPageNotFound') })
    if (!canEditWikiPage(page, user)) {
      return reply.status(403).send({ error: t('errors.wikiPageLocked') })
    }
    // Locking is a creator/admin decision — otherwise anyone could lock
    // everyone else out of a family page.
    if (body.locked !== undefined && body.locked !== page.locked && !canManageWikiPage(page, user)) {
      return reply.status(403).send({ error: t('errors.wikiPageLockForbidden') })
    }

    const { baseUpdatedAt, ...changes } = body
    // Conditional on updatedAt, so the check and the write are one atomic
    // step: two editors saving from the same version can't both win.
    const { count } = await prisma.wikiPage.updateMany({
      where: { id: pageId, ...(baseUpdatedAt ? { updatedAt: new Date(baseUpdatedAt) } : {}) },
      data: { ...changes, updatedById: user.id },
    })
    if (count === 0) {
      const current = await findVisibleWikiPage(pageId, user.id)
      if (!current) return reply.status(404).send({ error: t('errors.wikiPageNotFound') })
      return reply.status(409).send({ error: t('errors.wikiPageConflict'), page: shapeWikiPage(current, user) })
    }

    const updated = await prisma.wikiPage.findUniqueOrThrow({ where: { id: pageId }, include: wikiPageInclude })
    if (changes.content !== undefined) {
      await bindAssetsToScope(
        extractUploadPaths(updated.content),
        { groupIds: [updated.groupId], circleId: updated.circleId },
        user.id
      )
    }
    return shapeWikiPage(updated, user)
  })

  // Creator or admin only: with no revision history yet, a delete can't be
  // undone, so it isn't open to every member the way editing is.
  fastify.delete('/pages/:pageId', async (request, reply) => {
    const t = getT(request)
    const { pageId } = request.params as { pageId: string }
    const page = await findVisibleWikiPage(pageId, request.user!.id)
    if (!page) return reply.status(404).send({ error: t('errors.wikiPageNotFound') })
    if (!canManageWikiPage(page, request.user!)) {
      return reply.status(403).send({ error: t('errors.wikiPageDeleteForbidden') })
    }
    await prisma.wikiPage.delete({ where: { id: pageId } })
    return { success: true }
  })
}
