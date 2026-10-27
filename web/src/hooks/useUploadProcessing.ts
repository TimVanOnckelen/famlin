import { createContext, useContext } from 'react'
import { useQuery } from '@tanstack/react-query'
import { uploadKey, fetchUploadProcessing, type UploadProcessing } from '@famlin/api-client'

export const UploadProcessingContext = createContext<Record<string, UploadProcessing> | undefined>(undefined)
const finished = (state?: UploadProcessing) => state?.status === 'ready' || state?.status === 'failed'

export function useUploadProcessing(url: string) {
  const key = uploadKey(url)
  const metadata = useContext(UploadProcessingContext)
  const initial = key ? metadata?.[key] : undefined
  const query = useQuery({
    queryKey: ['upload-processing', key],
    queryFn: () => fetchUploadProcessing(key!),
    initialData: initial,
    enabled: (query) => !!key && !finished(initial) && !finished(query.state.data),
    staleTime: Infinity,
    refetchInterval: (query) => (finished(initial) || finished(query.state.data) ? false : 2000),
    retry: 1,
  })
  // A fresh post response can already contain the result of a pending job.
  const state = finished(initial) ? initial : (query.data ?? initial)
  return {
    ...state,
    pending: !!key && !query.isError && (!state || state.status === 'queued' || state.status === 'processing'),
    failed: !!key && (state?.status === 'failed' || (!finished(initial) && query.isError)),
  }
}
