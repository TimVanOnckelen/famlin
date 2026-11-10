import { InitialAvatar } from './common/InitialAvatar'
import { Button } from '@famlin/ui/button'
import { Alert } from '@famlin/ui/alert'
import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Logo } from './Logo'
import { User } from '../types'
import { api } from '../api/client'
import { LanguageSelector } from './LanguageSelector'
import { AlertBanner } from './AlertBanner'
import { Icon } from './Icon'

interface LayoutProps {
  user: User
  children: React.ReactNode
}

const OPERATIONS_ROUTES = ['/push-log', '/devices', '/storage', '/status']

export function Layout({ user, children }: LayoutProps) {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const operationsActive = OPERATIONS_ROUTES.includes(pathname)
  const [operationsOpen, setOperationsOpen] = useState(operationsActive)
  const [version, setVersion] = useState<string | null>(null)
  const [readOnly, setReadOnly] = useState(false)

  useEffect(() => {
    if (OPERATIONS_ROUTES.includes(pathname)) setOperationsOpen(true)
  }, [pathname])

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

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <Logo size={40} />
          <h1>{t('common.appName')}</h1>
        </div>
        <nav>
          <NavLink to="/" end>
            {t('layout.dashboard')}
          </NavLink>
          <NavLink to="/users">{t('layout.users')}</NavLink>
          <NavLink to="/groups">{t('layout.groups')}</NavLink>
          <NavLink to="/content">{t('layout.content')}</NavLink>
          <Button
            variant="ghost"
            type="button"
            className={`h-auto justify-start whitespace-normal rounded-sm px-3 py-3 sidebar-nav-group-trigger ${operationsOpen ? 'expanded' : ''}`}
            aria-expanded={operationsOpen}
            aria-controls="sidebar-operations-links"
            onClick={() => setOperationsOpen((open) => !open)}
          >
            {t('layout.operations')}
            <span className={operationsOpen ? 'sidebar-nav-chevron expanded' : 'sidebar-nav-chevron'}>
              <Icon name="chevron-down" size={16} />
            </span>
          </Button>
          <div id="sidebar-operations-links" className="sidebar-subnav" hidden={!operationsOpen}>
            <NavLink to="/push-log">{t('layout.pushLog')}</NavLink>
            <NavLink to="/devices">{t('layout.devices')}</NavLink>
            <NavLink to="/storage">{t('storage.title')}</NavLink>
            <NavLink to="/status">{t('layout.systemStatus')}</NavLink>
          </div>
          <NavLink to="/settings">{t('layout.serverSettings')}</NavLink>
        </nav>
        <div className="user">
          <div className="flex items-center gap-3">
            <InitialAvatar name={user.name} avatarUrl={user.avatarUrl} />
            <div className="min-w-0">
              <div className="truncate font-bold">{user.name}</div>
              <div className="truncate text-xs">{user.email}</div>
            </div>
          </div>
          <LanguageSelector className="sidebar-language" />
          <Button variant="secondary" className="secondary" onClick={handleLogout}>
            {t('layout.logout')}
          </Button>
          {version && (
            <div style={{ marginTop: '0.75rem', fontSize: '0.75rem' }}>{t('layout.version', { version })}</div>
          )}
        </div>
      </aside>
      <main className="main">
        {readOnly && (
          <Alert className="mb-6 border-warning/20 bg-warning/10 p-5 font-semibold" role="status">
            {t('layout.demoBanner')}
          </Alert>
        )}
        <AlertBanner />
        {children}
      </main>
    </div>
  )
}
