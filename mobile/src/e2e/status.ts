import type { E2eIdentityKeys, E2eOwnIdentity, FeatureSupport } from '@famlin/api-client'

export type E2eStatus = 'unsupported' | 'loading' | 'needsSetup' | 'needsRestore' | 'ready'

export function computeE2eStatus(input: {
  featureSupport: FeatureSupport
  /** The identity list request is in flight (or failed and will retry). */
  identitiesLoading: boolean
  /** The device's own key store has been read. */
  keysLoaded: boolean
  serverIdentities: E2eOwnIdentity[] | undefined
  localKeys: E2eIdentityKeys[]
}): E2eStatus {
  if (input.featureSupport === 'unsupported') return 'unsupported'
  if (!input.keysLoaded || input.identitiesLoading || !input.serverIdentities) return 'loading'
  if (input.serverIdentities.length === 0) return 'needsSetup'
  const latest = Math.max(...input.serverIdentities.map((identity) => identity.version))
  return input.localKeys.some((keys) => keys.version === latest) ? 'ready' : 'needsRestore'
}
