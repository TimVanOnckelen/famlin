import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { User, WikiPageSummary } from '@famlin/api-client'
import { AppShell } from '@/components/AppShell'
import { Icon } from '@/components/Icon'
import { formatRelativeDate } from '@/utils/time'

// Every wiki page shares the AppShell's nav callbacks.
export interface WikiShellProps {
  user: User
  onOpenFeed: () => void
  onOpenProfile: () => void
  onOpenPhotos?: () => void
  onOpenChat?: () => void
  onOpenFavorites?: () => void
  onOpenWiki?: () => void
  onOpenNotifications?: () => void
  onOpenSearch?: () => void
  onLogout: () => void
}

export function WikiShell({ shell, children }: { shell: WikiShellProps; children: ReactNode }) {
  return (
    <AppShell
      user={shell.user}
      active="wiki"
      onFeed={shell.onOpenFeed}
      onPhotos={shell.onOpenPhotos}
      onChat={shell.onOpenChat}
      onFavorites={shell.onOpenFavorites}
      onWiki={shell.onOpenWiki ?? (() => {})}
      onNotifications={shell.onOpenNotifications}
      onSearch={shell.onOpenSearch}
      onProfile={shell.onOpenProfile}
      onLogout={shell.onLogout}
    >
      {children}
    </AppShell>
  )
}

// A wiki page's category/circle/locked badges and "updated by … when" line,
// shared by the overview's rows and the page view.
export function WikiMeta({ page, className }: { page: WikiPageSummary; className?: string }) {
  const { t, i18n } = useTranslation()
  const when = formatRelativeDate(page.updatedAt, i18n.language)
  return (
    <span className={className}>
      {page.category && <span className="wiki-badge">{page.category}</span>}
      {page.circle && (
        <span className="wiki-badge wiki-badge-circle" title={t('wiki.circleHint')}>
          <Icon name="users" size={12} /> {page.circle.name}
        </span>
      )}
      {page.locked && (
        <span className="wiki-badge" title={t('wiki.lockedHint')}>
          <Icon name="lock" size={12} /> {t('wiki.locked')}
        </span>
      )}
      <span>
        {page.updatedBy ? t('wiki.updatedBy', { name: page.updatedBy.name, when }) : t('wiki.updated', { when })}
      </span>
    </span>
  )
}
