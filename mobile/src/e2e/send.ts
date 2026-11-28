import type { QueryClient } from '@tanstack/react-query'
import {
  e2eMyIdentitiesQueryKey,
  e2eUserIdentitiesQueryKey,
  encryptMessage,
  fetchMyE2eIdentities,
  fetchUserE2eIdentities,
  newMessageId,
  sendEncryptedChatMessage,
  type ChatConversationMessage,
  type E2eIdentityKeys,
  type E2eMessageContentV1,
  type E2ePublicIdentity,
} from '@famlin/api-client'
import { encryptAndUploadPhoto, type LocalPhoto } from '@/e2e/attachments'
import { setCachedContent } from '@/e2e/cache'

function statusOf(error: unknown): number | undefined {
  return (error as { response?: { status?: number } })?.response?.status
}

async function freshPeerIdentity(queryClient: QueryClient, peerId: string): Promise<E2ePublicIdentity> {
  const identities = await queryClient.fetchQuery({
    queryKey: e2eUserIdentitiesQueryKey(peerId),
    queryFn: () => fetchUserE2eIdentities(peerId),
    staleTime: 0,
  })
  const latest = identities[0]
  if (!latest) throw new Error('e2e: recipient has no identity')
  return {
    userId: peerId,
    version: latest.version,
    signPublicKey: latest.signPublicKey,
    boxPublicKey: latest.boxPublicKey,
  }
}

/**
 * Encrypt and send one message. The peer's latest identity is fetched fresh
 * (a cached one may predate their key reset); on a 409 — the server says a
 * version moved — both identity lists are refetched and the message re-sealed
 * once, unless nothing changed, in which case the error surfaces.
 */
export async function sendEncryptedMessage(opts: {
  queryClient: QueryClient
  conversationId: string
  sender: E2eIdentityKeys
  peerId: string
  text?: string
  photo?: LocalPhoto
  replyToMessageId?: string
}): Promise<ChatConversationMessage> {
  const { queryClient, conversationId, sender, peerId } = opts
  const content: E2eMessageContentV1 = { mid: newMessageId() }
  if (opts.text) content.text = opts.text
  if (opts.photo) content.attachment = await encryptAndUploadPhoto(opts.photo)

  const attempt = async (peer: E2ePublicIdentity, me: E2eIdentityKeys) => {
    const encryptedPayload = encryptMessage({ conversationId, sender: me, recipients: [peer], content })
    return sendEncryptedChatMessage(conversationId, {
      encryption: 'v1',
      encryptedPayload,
      ...(content.attachment ? { attachmentUrl: content.attachment.url } : {}),
      ...(opts.replyToMessageId ? { replyToMessageId: opts.replyToMessageId } : {}),
    })
  }

  const peer = await freshPeerIdentity(queryClient, peerId)
  try {
    const created = await attempt(peer, sender)
    setCachedContent(created.id, content)
    return created
  } catch (error) {
    if (statusOf(error) !== 409) throw error
    const [mine, freshPeer] = await Promise.all([
      queryClient.fetchQuery({ queryKey: e2eMyIdentitiesQueryKey(), queryFn: fetchMyE2eIdentities, staleTime: 0 }),
      freshPeerIdentity(queryClient, peerId),
    ])
    void queryClient.invalidateQueries({ queryKey: e2eMyIdentitiesQueryKey() })
    // My own identity moved on (a reset elsewhere): this device can't seal as the new one.
    if (mine[0]?.version !== sender.version) throw error
    if (freshPeer.version === peer.version) throw error
    const created = await attempt(freshPeer, sender)
    setCachedContent(created.id, content)
    return created
  }
}
