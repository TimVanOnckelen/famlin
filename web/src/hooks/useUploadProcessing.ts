import { useQuery } from '@tanstack/react-query';
import { uploadKey, fetchUploadProcessing } from '@famlin/api-client';

export function useUploadProcessing(url: string) {
  const key = uploadKey(url);
  const query = useQuery({
    queryKey: ['upload-processing', key],
    queryFn: () => fetchUploadProcessing(key!),
    enabled: !!key,
    staleTime: 0,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'ready' || status === 'failed' ? false : 2000;
    },
    retry: 1,
  });
  return {
    ...query.data,
    pending: !!key && !query.isError && (!query.data || query.data.status === 'queued' || query.data.status === 'processing'),
    failed: !!key && (query.isError || query.data?.status === 'failed'),
  };
}
