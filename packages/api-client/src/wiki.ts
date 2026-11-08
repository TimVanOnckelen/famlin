import { api } from './client'

// Family Wiki (issue #118): durable, editable family knowledge, one wiki per
// family. Circle-private pages are only ever returned to that circle's members.

export interface WikiPerson {
  id: string
  name: string
  avatarUrl: string | null
}

export interface WikiPageSummary {
  id: string
  groupId: string
  circle: { id: string; name: string } | null
  title: string
  emoji: string | null
  category: string | null
  locked: boolean
  // Plain-text preview of the content, Markdown stripped.
  excerpt: string
  // null once the person's account was deleted — the page stays.
  createdBy: WikiPerson | null
  updatedBy: WikiPerson | null
  createdAt: string
  updatedAt: string
}

export interface WikiPage extends WikiPageSummary {
  // Markdown.
  content: string
  // False on a locked page for anyone but its creator or an admin.
  canEdit: boolean
  // Creator or admin: may lock/unlock and delete.
  canManage: boolean
}

export interface WikiCategory {
  // null = uncategorized pages.
  name: string | null
  pageCount: number
}

export interface WikiPageListParams {
  groupId: string
  q?: string
  // '' = uncategorized pages only.
  category?: string
  cursor?: string
  take?: number
}

// Newest edit first — the overview's "recently updated" list, search results
// and a category's pages are all this one call.
export async function fetchWikiPages(
  params: WikiPageListParams
): Promise<{ items: WikiPageSummary[]; nextCursor: string | null }> {
  // requires-feature: wiki
  const response = await api.get<{ items: WikiPageSummary[]; nextCursor: string | null }>('/wiki/pages', { params })
  return response.data
}

export async function fetchWikiCategories(groupId: string): Promise<WikiCategory[]> {
  // requires-feature: wiki
  const response = await api.get<{ items: WikiCategory[] }>('/wiki/categories', { params: { groupId } })
  return response.data.items
}

export async function fetchWikiPage(pageId: string): Promise<WikiPage> {
  // requires-feature: wiki
  const response = await api.get<WikiPage>(`/wiki/pages/${pageId}`)
  return response.data
}

export interface CreateWikiPageBody {
  groupId: string
  // Narrows the page to one of your Family Circles; can't be changed later.
  circleId?: string | null
  title: string
  emoji?: string | null
  category?: string | null
  content?: string
  locked?: boolean
}

export async function createWikiPage(body: CreateWikiPageBody): Promise<WikiPage> {
  // requires-feature: wiki
  const response = await api.post<WikiPage>('/wiki/pages', body)
  return response.data
}

export interface UpdateWikiPageBody {
  title?: string
  emoji?: string | null
  category?: string | null
  content?: string
  locked?: boolean
  // The page's updatedAt when editing started: a save is refused (409, with
  // the current `page` in the response body) if someone saved in between.
  baseUpdatedAt?: string
}

export async function updateWikiPage(pageId: string, body: UpdateWikiPageBody): Promise<WikiPage> {
  // requires-feature: wiki
  const response = await api.patch<WikiPage>(`/wiki/pages/${pageId}`, body)
  return response.data
}

export async function deleteWikiPage(pageId: string): Promise<void> {
  // requires-feature: wiki
  await api.delete(`/wiki/pages/${pageId}`)
}

// The current version of the page when a save was refused because someone
// else saved in between (409), else null.
export function wikiConflictPage(err: unknown): WikiPage | null {
  const response = (err as { response?: { status?: number; data?: { page?: WikiPage } } })?.response
  return response?.status === 409 && response.data?.page ? response.data.page : null
}
