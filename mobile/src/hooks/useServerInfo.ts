import { useQuery } from '@tanstack/react-query'
import { fetchServerInfo, getCurrentServerUrl, serverSupports, type ServerFeature } from '@famlin/api-client'

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

// Whether the connected server has a named capability (issue #380) — hide
// the UI for it silently when not. `undefined` while server-info is still
// loading, so a caller can wait instead of flickering; treat it as `false`
// (the implicit baseline) when waiting isn't worth it. A failed request
// counts as the baseline.
export function useServerSupports(feature: ServerFeature): boolean | undefined {
  const { data, isPending, isError } = useServerInfo()
  if (isPending && !isError) return undefined
  return serverSupports(data, feature)
}
