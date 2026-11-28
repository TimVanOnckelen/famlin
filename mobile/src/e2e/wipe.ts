import { wipeScope, type E2eScope } from '@/e2e/keyStore'
import { useE2eKeysStore } from '@/e2e/keysStore'
import { clearE2eCache } from '@/e2e/cache'

// Explicit logout: forget this account's keys, recovery code, contact pins and
// anything decrypted in memory. (A session that merely expires keeps them.)
export async function wipeE2eData(scope: E2eScope | null): Promise<void> {
  useE2eKeysStore.getState().reset()
  clearE2eCache()
  try {
    // Decrypted photos live in the cache directory; required lazily so this
    // module stays light for the sign-out path.
    const { Directory, Paths } = require('expo-file-system')
    const photos = new Directory(Paths.cache, 'e2e-photos')
    if (photos.exists) photos.delete()
  } catch {
    // Best effort: the cache directory is purgeable by the OS anyway.
  }
  if (scope) await wipeScope(scope).catch(() => {})
}
