import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useE2e } from '@/e2e/useE2e'
import { createIdentity } from '@/e2e/actions'

/**
 * Opening a DM (or the inbox) on a server with encrypted messages creates this
 * account's keys automatically when it has none: no screen, no prompt.
 * Returns whether that failed, so the conversation can say messages aren't encrypted.
 */
export function useSilentE2eSetup(): boolean {
  const e2e = useE2e()
  const queryClient = useQueryClient()
  const [failed, setFailed] = useState(false)
  const { status, userId, serverIdentities } = e2e

  useEffect(() => {
    if (status !== 'needsSetup' || !userId || !serverIdentities || failed) return
    createIdentity({ userId, serverIdentities, queryClient }).catch(() => setFailed(true))
  }, [status, userId, serverIdentities, queryClient, failed])

  return failed
}
