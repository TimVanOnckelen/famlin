import { useQuery } from '@tanstack/react-query'
import {
  fetchServerInfo,
  getCurrentServerUrl,
  serverFeatureSupport,
  type FeatureSupport,
  type ServerFeature,
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
