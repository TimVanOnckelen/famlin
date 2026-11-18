import { InitialAvatar } from './common/InitialAvatar'
import { Alert } from '@famlin/ui/alert'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@famlin/ui/dropdown-menu'
import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Logo } from './Logo'
import { User } from '../types'
import { api } from '../api/client'
import { AlertBanner } from './AlertBanner'
import { Icon, type IconName } from './Icon'
import { useSystemAlerts } from '../lib/useSystemAlerts'
import { LANGUAGE_NAMES, SUPPORTED_LANGUAGES, storeLanguage, type SupportedLanguage } from '../i18n'

interface LayoutProps {
  user: User
  children: React.ReactNode
}

interface NavItem {
  to: string
  icon: IconName
  labelKey: string
  end?: boolean
  // Which alert conditions mark this entry with a dot (useSystemAlerts).
  alertGroup?: 'backup' | 'disk'
}

// Every destination stays visible — labeled sections instead of the old
// collapsible "Operations" group, so nothing hides behind a click.
const NAV_SECTIONS: { labelKey: string; items: NavItem[] }[] = [
  {
    labelKey: 'layout.sectionFamily',
    items: [
      { to: '/users', icon: 'users', labelKey: 'layout.users' },
      { to: '/groups', icon: 'home', labelKey: 'layout.groups' },
      { to: '/content', icon: 'content', labelKey: 'layout.content' },
    ],
  },
  {
    labelKey: 'layout.sectionServer',
    items: [
      { to: '/integrations', icon: 'integrations', labelKey: 'layout.integrations' },
      { to: '/backups', icon: 'backups', labelKey: 'layout.backups', alertGroup: 'backup' },
      { to: '/settings', icon: 'settings', labelKey: 'layout.serverSettings' },
    ],
  },
  {
    labelKey: 'layout.sectionMonitoring',
    items: [
      { to: '/status', icon: 'status', labelKey: 'layout.systemStatus', alertGroup: 'disk' },
      { to: '/push-log', icon: 'push-log', labelKey: 'layout.pushLog' },
      { to: '/devices', icon: 'devices', labelKey: 'layout.devices' },
      { to: '/diagnostics', icon: 'diagnostics', labelKey: 'layout.diagnostics' },
    ],
  },
]

export function Layout({ user, children }: LayoutProps) {
  const { t, i18n } = useTranslation()
  const { pathname } = useLocation()
  const { alerts, update } = useSystemAlerts(pathname)
  const [version, setVersion] = useState<string | null>(null)
  const [readOnly, setReadOnly] = useState(false)

  const alertDots = {
    backup: alerts.some((a) => a.condition === 'backup_failed' || a.condition === 'backup_stale'),
    disk: alerts.some((a) => a.condition === 'disk_low_uploads' || a.condition === 'disk_low_backups'),
  }

  // Fail-soft, one-shot — a failed fetch just means no version line, same as
  // DashboardPage's update-check.
  useEffect(() => {
    api
      .getServerInfo()
      .then((info) => {
        setVersion(info.version)
        setReadOnly(info.readOnly === true)
      })
      .catch(() => {})
  }, [])

  const handleLogout = () => {
    localStorage.removeItem('famlin_admin_token')
    window.location.href = '/admin/'
  }

  const handleLanguage = (lang: string) => {
    storeLanguage(lang as SupportedLanguage)
    void i18n.changeLanguage(lang)
  }

  const renderItem = (item: NavItem) => (
    <NavLink key={item.to} to={item.to} end={item.end} className="sidebar-nav-item">
      <span className="sidebar-nav-icon">
        <Icon name={item.icon} size={17} />
      </span>
      <span className="sidebar-nav-label">{t(item.labelKey)}</span>
      {item.alertGroup && alertDots[item.alertGroup] && (
        <span className="sidebar-nav-dot" role="img" aria-label={t('layout.alertIndicator')} />
      )}
    </NavLink>
  )

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <Logo size={40} />
          <h1>{t('common.appName')}</h1>
        </div>
        <nav>
          {renderItem({ to: '/', icon: 'dashboard', labelKey: 'layout.dashboard', end: true })}
          {NAV_SECTIONS.map((section) => (
            <div key={section.labelKey} className="sidebar-nav-section">
              <div className="sidebar-nav-heading">{t(section.labelKey)}</div>
              {section.items.map(renderItem)}
            </div>
          ))}
        </nav>
        <div className="sidebar-user">
          <DropdownMenu>
            <DropdownMenuTrigger className="sidebar-user-trigger" aria-label={t('layout.accountMenu')}>
              <InitialAvatar name={user.name} avatarUrl={user.avatarUrl} />
              <span className="sidebar-user-name">{user.name}</span>
              <span className="sidebar-user-chevron">
                <Icon name="chevron-down" size={16} />
              </span>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="sidebar-user-menu">
              <div className="sidebar-user-email">{user.email}</div>
              <DropdownMenuSeparator />
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Icon name="language" size={16} />
                  {t('layout.language')}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuRadioGroup
                    value={i18n.resolvedLanguage ?? i18n.language}
                    onValueChange={(value) => handleLanguage(String(value))}
                  >
                    {SUPPORTED_LANGUAGES.map((lang) => (
                      <DropdownMenuRadioItem key={lang} value={lang}>
                        {LANGUAGE_NAMES[lang]}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              {version && (
                <>
                  <DropdownMenuSeparator />
                  <div className="sidebar-user-version">{t('layout.version', { version })}</div>
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout}>
                <Icon name="logout" size={16} />
                {t('layout.logout')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>
      <main className="main">
        {readOnly && (
          <Alert className="mb-6 border-warning/20 bg-warning/10 p-5 font-semibold" role="status">
            {t('layout.demoBanner')}
          </Alert>
        )}
        <AlertBanner alerts={alerts} update={update} />
        {children}
      </main>
    </div>
  )
}
