import { useQuery } from '@tanstack/react-query'
import {
  fetchServerInfo,
  getCurrentServerUrl,
  resolveDirectMessagePolicy,
  resolveServerLimits,
  serverFeatureSupport,
  type DirectMessagePolicy,
  type FeatureSupport,
  type ServerFeature,
  type ServerLimits,
} from '@famlin/api-client'
import { withMissingMark } from '@/utils/serverFeatures'

// GET /api/auth/server-info, keyed by server so switching servers never
// serves the previous one's info (the query cache isn't cleared on logout).
// It only changes when the server is upgraded, so it's kept for a while.
export function useServerInfo() {
  return useQuery({
    queryKey: ['server-info', getCurrentServerUrl()],
    queryFn: fetchServerInfo,
    staleTime: 10 * 60 * 1000,
  })
}

// The server's attachment/video/upload limits (issue #436), with the old
// built-in values while server-info loads or on a server that predates them.
export function useServerLimits(): ServerLimits {
  return resolveServerLimits(useServerInfo().data)
}

// Whether the connected server has a named capability (issue #380):
// 'supported' / 'unsupported' when it advertises its features, 'unknown'
// while server-info loads, if it failed, or on a server that predates the
// `features` field (0.8.7 and older) for an id that predates it. Hide the
// feature only when 'unsupported'; on 'unknown' use it and treat a 404 from
// its endpoint as unsupported (isNotFoundError, retryUnlessNotFound and
// rememberNotFound in utils/serverFeatures). A 404 recorded by
// rememberNotFound turns 'unknown' into 'unsupported' here; the query's
// own error re-renders the caller, so the mark is read on that render.
export function useServerFeatureSupport(feature: ServerFeature): FeatureSupport {
  const { data } = useServerInfo()
  return withMissingMark(serverFeatureSupport(data, feature), feature)
}

export interface DirectMessagePolicyState extends DirectMessagePolicy {
  /** The server states the policy itself (newer servers); otherwise it is derived from its features. */
  explicit: boolean
  /** The administrator turned direct messages off. Family chat is unaffected. */
  disabledByAdmin: boolean
  /** DMs are on but the administrator turned encryption off: new messages are readable by them. */
  encryptionDisabledByAdmin: boolean
}

export function directMessagePolicyOf(
  info: Parameters<typeof resolveDirectMessagePolicy>[0]
): DirectMessagePolicyState {
  const policy = resolveDirectMessagePolicy(info)
  const explicit = !!info?.directMessages
  return {
    ...policy,
    explicit,
    disabledByAdmin: explicit && !policy.enabled,
    encryptionDisabledByAdmin: explicit && policy.enabled && !policy.encryption,
  }
}

export function useDirectMessagePolicy(): DirectMessagePolicyState {
  return directMessagePolicyOf(useServerInfo().data)
}

/** `directMessages` support, forced to 'unsupported' when the administrator turned DMs off. */
export function useDirectMessagesSupport(): FeatureSupport {
  const support = useServerFeatureSupport('directMessages')
  return useDirectMessagePolicy().disabledByAdmin ? 'unsupported' : support
}
