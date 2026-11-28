import { useQuery } from '@tanstack/react-query'
import { Platform } from 'react-native'
import { getKeySyncAvailability } from '@/e2e/keySync'
import { needsRecoveryCodeBackup } from '@/e2e/backupReminder'

export function useKeySyncAvailability() {
  return useQuery({ queryKey: ['e2e', 'key-sync-availability'], queryFn: getKeySyncAvailability, staleTime: 60 * 1000 })
}

/** Whether to suggest making a recovery code (see needsRecoveryCodeBackup). */
export function useNeedsRecoveryCode(hasRecoveryCode: boolean): boolean {
  const { data } = useKeySyncAvailability()
  return needsRecoveryCodeBackup({ platform: Platform.OS, sync: data, hasRecoveryCode })
}
