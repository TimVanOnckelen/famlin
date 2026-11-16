import { createContext, useContext } from 'react'
import { useQuery } from '@tanstack/react-query'
import { uploadKey, fetchUploadProcessing, type UploadProcessing } from '@famlin/api-client'
import { useServerFeatureSupport } from './useServerInfo'

export const UploadProcessingContext = createContext<Record<string, UploadProcessing> | undefined>(undefined)
const finished = (state?: UploadProcessing) => state?.status === 'ready' || state?.status === 'failed'

// What a server without the `uploadProcessing` feature implies: uploads are
// stored synchronously, so every one is ready as-is (null urls make callers
// fall back to the original URL).
const READY: UploadProcessing = { status: 'ready', url: null, thumbnailUrl: null }

export type UploadProcessingState = Partial<UploadProcessing> & { pending: boolean; failed: boolean }

// The state of an upload that needs no status request: a URL that isn't an
// upload at all, or one whose post already says it's ready or failed. Returns
// null when only the server can tell, which is when useUploadProcessing is
// needed. Lets a feed tile skip that hook's two query subscriptions, which is
// most of what a photo costs the JS thread as its card scrolls in.
export function settledUploadProcessing(
  url: string,
  metadata: Record<string, UploadProcessing> | undefined
): UploadProcessingState | null {
  const key = uploadKey(url)
  if (!key) return { pending: false, failed: false }
  const initial = metadata?.[key]
  if (!initial || !finished(initial)) return null
  return { ...initial, pending: false, failed: initial.status === 'failed' }
}

export function useUploadProcessing(url: string): UploadProcessingState {
  const key = uploadKey(url)
  const metadata = useContext(UploadProcessingContext)
  const initial = key ? metadata?.[key] : undefined
  // Only a server that advertises a features list without uploadProcessing
  // is skipped (issue #380). On one too old to advertise ('unknown'), the
  // status request runs and fetchUploadProcessing maps its 404 to ready.
  // Post upload metadata only ever comes from a server with the feature.
  const support = useServerFeatureSupport('uploadProcessing')
  const unsupported = initial === undefined && support === 'unsupported'
  const query = useQuery({
    queryKey: ['upload-processing', key],
    queryFn: () => fetchUploadProcessing(key!),
    initialData: initial,
    enabled: (query) => !!key && !unsupported && !finished(initial) && !finished(query.state.data),
    staleTime: Infinity,
    refetchInterval: (query) => (unsupported || finished(initial) || finished(query.state.data) ? false : 2000),
    retry: 1,
  })
  if (unsupported) {
    return { ...READY, pending: false, failed: false }
  }
  // A fresh post response can already contain the result of a pending job.
  // Live Photos (`livePhotos`) need no gate of their own: they only ever
  // surface through this state's `kind: 'livePhoto'`, which only a server
  // that pairs them sends — and a 0.8.7 server does without advertising it.
  const state = finished(initial) ? initial : (query.data ?? initial)
  return {
    ...state,
    pending: !!key && !query.isError && (!state || state.status === 'queued' || state.status === 'processing'),
    failed: !!key && (state?.status === 'failed' || (!finished(initial) && query.isError)),
  }
}
