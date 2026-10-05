import { useQuery } from '@tanstack/react-query';
import { fetchServerInfo, type Branding } from '@famlin/api-client';

// The family's branding from GET /api/auth/server-info (shares the cache
// entry ReadOnlyBanner and ProfilePage already use). `null` = today's look.
export function useBranding(): Branding | null {
  const { data } = useQuery({ queryKey: ['server-info'], queryFn: fetchServerInfo });
  return data?.branding ?? null;
}
