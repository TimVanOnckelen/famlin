import type { useTranslation } from 'react-i18next'
import type { IntegrationId, IntegrationSummary } from '../../api/client'
import type { IconName } from '../Icon'

export type IntegrationTab = 'connection' | 'families' | 'people' | 'activity'
export type IntegrationGroup = 'photos' | 'signin' | 'messages' | 'storage'

// One entry per integration: where it sits on the overview and which tabs
// its page has. A new media source is one entry here plus its Connection
// panel in IntegrationPage.tsx.
export const INTEGRATIONS: Record<IntegrationId, { group: IntegrationGroup; icon: IconName; tabs: IntegrationTab[] }> =
  {
    immich: { group: 'photos', icon: 'image', tabs: ['connection', 'families', 'people', 'activity'] },
    local: { group: 'photos', icon: 'folder', tabs: ['connection', 'families', 'activity'] },
    sso: { group: 'signin', icon: 'key', tabs: ['connection'] },
    apple: { group: 'signin', icon: 'shield', tabs: ['connection'] },
    email: { group: 'messages', icon: 'mail', tabs: ['connection', 'activity'] },
    push: { group: 'messages', icon: 'bell', tabs: ['connection', 'activity'] },
    storage: { group: 'storage', icon: 'layers', tabs: ['connection'] },
  }

export const INTEGRATION_GROUPS: IntegrationGroup[] = ['photos', 'signin', 'messages', 'storage']

export const isIntegrationId = (id: string | undefined): id is IntegrationId => !!id && id in INTEGRATIONS

// The one or two lines under an integration's name: what it's used for.
type Translate = ReturnType<typeof useTranslation>['t']

const albumsLine = (u: IntegrationSummary['usage'], t: Translate) =>
  `${t('integrations.usage.families', { count: Number(u.families) })} · ${t('integrations.usage.albums', { count: Number(u.albums) })}`

export function usageLines(summary: IntegrationSummary, t: Translate): string[] {
  const u = summary.usage
  switch (summary.id) {
    case 'immich':
      if (!summary.configured) return [t('integrations.usage.notSetUp')]
      return [
        albumsLine(u, t),
        ...(u.mirroring ? [t('integrations.usage.mirroring', { count: Number(u.mirroring) })] : []),
      ]
    case 'local':
      return summary.configured ? [albumsLine(u, t)] : [t('integrations.usage.notSetUp')]
    case 'sso':
      return summary.configured
        ? [t('integrations.usage.sso', { name: u.name, host: u.issuerHost ?? '' })]
        : [t('integrations.usage.notSetUp')]
    case 'apple':
      return [
        u.extraBundleIds
          ? t('integrations.usage.appleExtra', { count: Number(u.extraBundleIds) })
          : t('integrations.usage.appleOfficial'),
      ]
    case 'email':
      return summary.configured ? [t('integrations.usage.email', { host: u.host })] : [t('integrations.usage.notSetUp')]
    case 'push':
      return summary.configured
        ? [
            t('integrations.usage.push', {
              count: Number(u.devices),
              delivered: u.deliveredLast7d,
              failed: u.failedLast7d,
            }),
          ]
        : [t('integrations.usage.pushOff')]
    case 'storage':
      return [
        u.driver === 's3' ? t('integrations.usage.storageS3') : t('integrations.usage.storageLocal'),
        ...(u.fallbackDriver ? [t('integrations.usage.storageFallback')] : []),
      ]
  }
}
