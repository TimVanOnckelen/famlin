import { Prisma } from '@prisma/client'
import { prisma } from '../db.js'
import { getUserCircleIds, isCircleMember } from './circles.js'
import { isGroupMember } from './groups.js'
import { EMBEDDED_UPLOAD_PATH_REGEX } from '../types.js'

// Family Wiki (issue #118). A WikiPage follows the Post audience model:
// group membership is the outer boundary, an optional circleId narrows it.

// THE wiki page visibility predicate — the WikiPage counterpart of
// visiblePostsWhere (services/circles.ts), with the same fail-open warning:
// every member-facing query that reads wiki pages must compose its own
// filter with this one, or it serves circle-private pages to the whole
// family. `groupIds` must already be authorized for the caller.
export function visibleWikiPagesWhere(groupIds: string[], circleIds: string[]): Prisma.WikiPageWhereInput {
  return {
    groupId: { in: groupIds },
    OR: [{ circleId: null }, { circleId: { in: circleIds } }],
  }
}

export async function visibleWikiPagesWhereFor(groupIds: string[], userId: string): Promise<Prisma.WikiPageWhereInput> {
  return visibleWikiPagesWhere(groupIds, await getUserCircleIds(userId))
}

// Loads one page only if the caller can see it: a member of its family and,
// for a circle-private page, of that circle. Anything else is null, so a
// route 404s rather than 403s and a circle's pages can't be probed.
export async function findVisibleWikiPage(pageId: string, userId: string) {
  const page = await prisma.wikiPage.findUnique({ where: { id: pageId }, include: wikiPageInclude })
  if (!page) return null
  if (!(await isGroupMember(page.groupId, userId))) return null
  if (page.circleId && !(await isCircleMember(page.circleId, userId))) return null
  return page
}

const userSelect = { select: { id: true, name: true, avatarUrl: true } } as const

export const wikiPageInclude = {
  circle: { select: { id: true, name: true } },
  createdBy: userSelect,
  updatedBy: userSelect,
} satisfies Prisma.WikiPageInclude

type WikiPageRow = Prisma.WikiPageGetPayload<{ include: typeof wikiPageInclude }>

// Every /uploads/ path embedded in a page's Markdown, so saving a page can
// bind the photos it shows to the page's audience (bindAssetsToScope).
export function extractUploadPaths(content: string): string[] {
  return [...new Set(content.match(EMBEDDED_UPLOAD_PATH_REGEX) ?? [])]
}

// A plain-text preview for list rows, so the overview never ships whole pages.
export function wikiExcerpt(content: string, max = 160): string {
  // Only the head of the page can end up in a 160-character preview — and
  // the regexes below are quadratic on adversarial input (a run of unclosed
  // `[`), so they must never see a whole 50 KB page on every list request.
  const text = content
    .slice(0, 2000)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links → their text
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+(\[[ xX]\]\s+)?/gm, '') // block markers
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

export function canEditWikiPage(
  page: { locked: boolean; createdById: string | null },
  user: { id: string; isAdmin: boolean }
) {
  return !page.locked || page.createdById === user.id || user.isAdmin
}

export function canManageWikiPage(page: { createdById: string | null }, user: { id: string; isAdmin: boolean }) {
  return page.createdById === user.id || user.isAdmin
}

export function shapeWikiPageSummary(page: WikiPageRow) {
  return {
    id: page.id,
    groupId: page.groupId,
    circle: page.circle,
    title: page.title,
    emoji: page.emoji,
    category: page.category,
    locked: page.locked,
    excerpt: wikiExcerpt(page.content),
    createdBy: page.createdBy,
    updatedBy: page.updatedBy,
    createdAt: page.createdAt,
    updatedAt: page.updatedAt,
  }
}

export function shapeWikiPage(page: WikiPageRow, user: { id: string; isAdmin: boolean }) {
  return {
    ...shapeWikiPageSummary(page),
    content: page.content,
    canEdit: canEditWikiPage(page, user),
    canManage: canManageWikiPage(page, user),
  }
}
