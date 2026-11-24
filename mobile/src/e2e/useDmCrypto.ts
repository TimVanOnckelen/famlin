import { useEffect, useMemo, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  E2E_MESSAGE_ENCRYPTION,
  safetyCode,
  type ChatConversation,
  type ChatConversationMessage,
} from '@famlin/api-client'
import { useE2e, useContactIdentities, toPublicIdentities } from '@/e2e/useE2e'
import { useE2eKeysStore } from '@/e2e/keysStore'
import { decideSend, type SendDecision } from '@/e2e/sendRule'
import { dedupeByMid, decryptChatPayload, type DecryptResult } from '@/e2e/decrypt'
import { useSilentE2eSetup } from '@/e2e/useSilentSetup'
import { evaluateContactPin, isSafetyCodeVerified } from '@/e2e/contactPin'

export type DmRowKind = 'plain' | 'encrypted' | 'unsupported' | 'system'

export interface DmRow {
  message: ChatConversationMessage
  kind: DmRowKind
  result?: DecryptResult
}

function isSystem(message: ChatConversationMessage): boolean {
  return message.kind === 'SYSTEM_ENCRYPTION_DISABLED' || message.kind === 'SYSTEM_ENCRYPTION_ENABLED'
}

/** Everything a private conversation needs to show and send end-to-end encrypted messages. */
export function useDmCrypto(conversation: ChatConversation | undefined, items: ChatConversationMessage[]) {
  const e2e = useE2e()
  const setupFailed = useSilentE2eSetup()
  const queryClient = useQueryClient()
  const userId = e2e.userId
  const peerId = conversation?.participants.find((participant) => participant.id !== userId)?.id
  const peerQuery = useContactIdentities(peerId, e2e.status !== 'unsupported' || e2e.serverEncryptionDisabled)
  const { meta, loaded, setContactPin } = useE2eKeysStore()

  const myPublic = useMemo(
    () => (userId ? toPublicIdentities(userId, e2e.serverIdentities) : undefined),
    [userId, e2e.serverIdentities]
  )
  const peerPublic = useMemo(
    () => (peerId ? toPublicIdentities(peerId, peerQuery.data) : undefined),
    [peerId, peerQuery.data]
  )

  const decision: SendDecision = decideSend({
    status: e2e.status,
    peerIdentityCount: peerQuery.isError ? undefined : peerQuery.data?.length,
    encryptionDisabledAt: conversation?.encryptionDisabledAt,
    setupFailed,
    serverEncryptionDisabled: e2e.serverEncryptionDisabled,
  })

  const rows = useMemo<DmRow[]>(() => {
    const decrypted = items.map<DmRow>((message) => {
      if (isSystem(message)) return { message, kind: 'system' }
      if (message.encryption === 'none') return { message, kind: 'plain' }
      if (message.encryption !== E2E_MESSAGE_ENCRYPTION) return { message, kind: 'unsupported' }
      const result = decryptChatPayload({
        messageId: message.id,
        conversationId: message.conversationId,
        authorId: message.authorId,
        payload: message.encryptedPayload,
        myKeys: e2e.myKeys,
        senderIdentities: message.authorId === userId ? myPublic : peerPublic,
      })
      return { message, kind: 'encrypted', result }
    })
    const kept = new Set(
      dedupeByMid(
        decrypted,
        (row) => row.message.id,
        (row) => (row.result?.status === 'ok' ? row.result.content.mid : undefined)
      ).map((row) => row.message.id)
    )
    return decrypted.filter((row) => kept.has(row.message.id))
  }, [items, e2e.myKeys, userId, myPublic, peerPublic])

  // A message from a key version we haven't seen: refetch the identities once.
  const refetchedMissing = useRef(false)
  const missingIdentity = rows.some((row) => row.result?.status === 'error' && row.result.code === 'missing_identity')
  useEffect(() => {
    if (!missingIdentity || refetchedMissing.current) return
    refetchedMissing.current = true
    void peerQuery.refetch()
    void e2e.refetch()
  }, [missingIdentity, peerQuery, e2e])

  const latestPeer = peerPublic?.[0]
  const latestMine = myPublic?.[0]
  const code = useMemo(
    () => (latestPeer && latestMine ? safetyCode(latestMine, latestPeer) : null),
    [latestPeer, latestMine]
  )

  const pin = peerId ? meta.contacts[peerId] : undefined
  const evaluation = useMemo(
    () => (latestPeer && loaded ? evaluateContactPin(pin, latestPeer) : null),
    [latestPeer, loaded, pin]
  )
  useEffect(() => {
    if (peerId && evaluation?.write) void setContactPin(peerId, evaluation.pin)
  }, [peerId, evaluation, setContactPin])

  return {
    e2e,
    peerId,
    peerQuery,
    decision,
    rows,
    safetyCode: code,
    verified: isSafetyCodeVerified(pin, code),
    keyChanged: !!evaluation?.changed,
    dismissKeyChange: () => {
      if (peerId && evaluation) void setContactPin(peerId, { ...evaluation.pin, acknowledged: true })
    },
    queryClient,
  }
}
