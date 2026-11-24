import { useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  e2eMyIdentitiesQueryKey,
  e2eUserIdentitiesQueryKey,
  fetchMyE2eIdentities,
  fetchUserE2eIdentities,
  type E2eIdentityKeys,
  type E2eOwnIdentity,
  type E2ePublishedIdentity,
  type E2ePublicIdentity,
} from '@famlin/api-client'
import { useAuthStore } from '@/stores/authStore'
import { useServerFeatureSupport } from '@/hooks/useServerInfo'
import { rememberNotFound, retryUnlessNotFound } from '@/utils/serverFeatures'
import { useE2eKeysStore } from '@/e2e/keysStore'
import { computeE2eStatus, type E2eStatus } from '@/e2e/status'

const FEATURE = 'e2eDirectMessages' as const

export interface E2eState {
  status: E2eStatus
  userId: string | undefined
  /** Own identity versions on the server, newest first. */
  serverIdentities: E2eOwnIdentity[] | undefined
  latestServerVersion: number | undefined
  /** All identity versions held on this device. */
  myKeys: E2eIdentityKeys[]
  /** The keys for the server's latest identity, when this device has them. */
  latestKeys: E2eIdentityKeys | undefined
  recoveryCode: string | null
  recoveryConfirmed: boolean
  refetch: () => Promise<unknown>
}

export function useE2e(): E2eState {
  const userId = useAuthStore((state) => state.user?.id)
  const serverUrl = useAuthStore((state) => state.serverUrl)
  const support = useServerFeatureSupport(FEATURE)
  const { keys, loaded, recovery, loadForScope } = useE2eKeysStore()

  useEffect(() => {
    if (userId && serverUrl) void loadForScope({ serverUrl, userId })
  }, [userId, serverUrl, loadForScope])

  const query = useQuery({
    queryKey: [...e2eMyIdentitiesQueryKey(), serverUrl, userId],
    queryFn: rememberNotFound(FEATURE, fetchMyE2eIdentities),
    enabled: support !== 'unsupported' && !!userId && !!serverUrl,
    retry: retryUnlessNotFound,
    staleTime: 30 * 1000,
  })

  const status = computeE2eStatus({
    featureSupport: support,
    identitiesLoading: query.isPending || (query.isError && !query.data),
    keysLoaded: loaded,
    serverIdentities: query.data,
    localKeys: keys,
  })
  const latestServerVersion = query.data?.[0]?.version
  const latestKeys = useMemo(
    () => keys.find((candidate) => candidate.version === latestServerVersion),
    [keys, latestServerVersion]
  )

  return {
    status,
    userId,
    serverIdentities: query.data,
    latestServerVersion,
    myKeys: keys,
    latestKeys,
    recoveryCode: recovery?.code ?? null,
    recoveryConfirmed: recovery?.confirmed ?? true,
    refetch: query.refetch,
  }
}

/** A contact's published identity versions (newest first); undefined while loading. */
export function useContactIdentities(contactId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: e2eUserIdentitiesQueryKey(contactId ?? ''),
    queryFn: () => fetchUserE2eIdentities(contactId as string),
    enabled: enabled && !!contactId,
    staleTime: 60 * 1000,
  })
}

/** The published identities as full public identities (the API omits the userId). */
export function toPublicIdentities(
  userId: string,
  identities: Pick<E2ePublishedIdentity, 'version' | 'signPublicKey' | 'boxPublicKey'>[] | undefined
): E2ePublicIdentity[] | undefined {
  return identities?.map((identity) => ({
    userId,
    version: identity.version,
    signPublicKey: identity.signPublicKey,
    boxPublicKey: identity.boxPublicKey,
  }))
}
