import { createContext, useContext } from 'react'
import { useQuery } from '@tanstack/react-query'
import { uploadKey, fetchUploadProcessing, type UploadProcessing } from '@famlin/api-client'
import { useServerSupports } from './useServerInfo'

export const UploadProcessingContext = createContext<Record<string, UploadProcessing> | undefined>(undefined)
const finished = (state?: UploadProcessing) => state?.status === 'ready' || state?.status === 'failed'

// What a server without the `uploadProcessing` feature implies: uploads are
// stored synchronously, so every one is ready as-is (null urls make callers
// fall back to the original URL).
const READY: UploadProcessing = { status: 'ready', url: null, thumbnailUrl: null }

export function useUploadProcessing(url: string) {
  const key = uploadKey(url)
  const metadata = useContext(UploadProcessingContext)
  const initial = key ? metadata?.[key] : undefined
  const supportsProcessing = useServerSupports('uploadProcessing')
  // Post upload metadata only ever comes from a server with the feature, so
  // it settles the question before /server-info has loaded. Without either,
  // the status request waits (shown as pending, as it would be while that
  // request runs) rather than hitting an endpoint an older server lacks.
  const supported = initial !== undefined || supportsProcessing === true
  const query = useQuery({
    queryKey: ['upload-processing', key],
    queryFn: () => fetchUploadProcessing(key!),
    initialData: initial,
    enabled: (query) => !!key && supported && !finished(initial) && !finished(query.state.data),
    staleTime: Infinity,
    refetchInterval: (query) => (!supported || finished(initial) || finished(query.state.data) ? false : 2000),
    retry: 1,
  })
  if (!supported && supportsProcessing === false) {
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
