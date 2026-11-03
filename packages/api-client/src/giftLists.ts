import { api } from './client'
import type { GiftListItem, Post } from './types'

// Gift lists (issue #307). The post itself is created/read/deleted through the
// ordinary posts endpoints (type 'GIFT_LIST'); these cover the wishlists,
// participants, settings and the Secret Santa draw. Every endpoint 404s for
// anyone who isn't a participant.

// Every gift list you take part in, across your families, newest occasion first.
export async function fetchMyGiftLists(): Promise<Post[]> {
  const response = await api.get<{ items: Post[] }>('/gift-lists')
  return response.data.items
}

export async function fetchGiftListItems(postId: string): Promise<GiftListItem[]> {
  const response = await api.get<{ items: GiftListItem[] }>(`/gift-lists/${postId}/items`)
  return response.data.items
}

export interface GiftListItemBody {
  title: string
  note?: string | null
  // http(s) only.
  url?: string | null
  // An /uploads/ path from uploadFiles().
  photoUrl?: string | null
}

export async function createGiftListItem(postId: string, body: GiftListItemBody): Promise<GiftListItem> {
  const response = await api.post<GiftListItem>(`/gift-lists/${postId}/items`, body)
  return response.data
}

export async function updateGiftListItem(
  postId: string,
  itemId: string,
  body: Partial<GiftListItemBody>
): Promise<GiftListItem> {
  const response = await api.patch<GiftListItem>(`/gift-lists/${postId}/items/${itemId}`, body)
  return response.data
}

export async function deleteGiftListItem(postId: string, itemId: string): Promise<void> {
  await api.delete(`/gift-lists/${postId}/items/${itemId}`)
}

// `itemIds` must be every one of your own wishes, in the new order.
export async function reorderGiftListItems(postId: string, itemIds: string[]): Promise<GiftListItem[]> {
  const response = await api.put<{ items: GiftListItem[] }>(`/gift-lists/${postId}/items/order`, { itemIds })
  return response.data.items
}

export interface GiftListSettingsBody {
  title?: string
  occasionDate?: string | null
  drawEnabled?: boolean
  budget?: string | null
  exclusions?: Array<[string, string]>
  // Required to confirm a change that discards an existing draw (else 409).
  confirmRedraw?: boolean
}

// Starter only.
export async function updateGiftListSettings(postId: string, body: GiftListSettingsBody): Promise<Post> {
  const response = await api.patch<Post>(`/gift-lists/${postId}`, body)
  return response.data
}

// Starter only. `userIds` = everyone besides the starter.
export async function setGiftListParticipants(postId: string, userIds: string[], confirmRedraw = false): Promise<Post> {
  const response = await api.put<Post>(`/gift-lists/${postId}/participants`, { userIds, confirmRedraw })
  return response.data
}

// Starter only, once.
export async function drawGiftList(postId: string): Promise<Post> {
  const response = await api.post<Post>(`/gift-lists/${postId}/draw`)
  return response.data
}

// Anyone but the starter.
export async function leaveGiftList(postId: string): Promise<void> {
  await api.delete(`/gift-lists/${postId}/participants/me`)
}

// A 409 from settings/participants means "this would discard the draw" —
// clients ask for confirmation, then resend with confirmRedraw.
export function isGiftDrawResetConflict(err: unknown): boolean {
  return (err as { response?: { status?: number } })?.response?.status === 409
}
