import { InitialAvatar } from './common/InitialAvatar'
import { Button } from '@famlin/ui/button'
import { Alert } from '@famlin/ui/alert'
import { Sheet, SheetContent, SheetTitle } from '@famlin/ui/sheet'
import { useEffect, useId, useState } from 'react'
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
  const [menuOpen, setMenuOpen] = useState(false)
  const [version, setVersion] = useState<string | null>(null)
  const [readOnly, setReadOnly] = useState(false)
  const operationsListId = useId()
  const menuDrawerId = useId()

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

  // Shared between the desktop sidebar and the mobile drawer; ids are unique
  // per instance because both render in the DOM at once. The drawer omits the
  // logo mark next to the wordmark.
  const renderNav = (operationsLinksId: string, showLogo: boolean) => (
    <>
      <div className="sidebar-brand">
        {showLogo && <Logo size={40} />}
        <h1>{t('common.appName')}</h1>
      </div>
      <nav>
        <NavLink to="/" end onClick={() => setMenuOpen(false)}>
          {t('layout.dashboard')}
        </NavLink>
        <NavLink to="/users" onClick={() => setMenuOpen(false)}>
          {t('layout.users')}
        </NavLink>
        <NavLink to="/groups" onClick={() => setMenuOpen(false)}>
          {t('layout.groups')}
        </NavLink>
        <NavLink to="/content" onClick={() => setMenuOpen(false)}>
          {t('layout.content')}
        </NavLink>
        <Button
          variant="ghost"
          type="button"
          className={`h-auto justify-start whitespace-normal rounded-sm px-3 py-3 sidebar-nav-group-trigger ${operationsOpen ? 'expanded' : ''}`}
          aria-expanded={operationsOpen}
          aria-controls={operationsLinksId}
          onClick={() => setOperationsOpen((open) => !open)}
        >
          {t('layout.operations')}
          <span className={operationsOpen ? 'sidebar-nav-chevron expanded' : 'sidebar-nav-chevron'}>
            <Icon name="chevron-down" size={16} />
          </span>
        </Button>
        <div id={operationsLinksId} className="sidebar-subnav" hidden={!operationsOpen}>
          <NavLink to="/push-log" onClick={() => setMenuOpen(false)}>
            {t('layout.pushLog')}
          </NavLink>
          <NavLink to="/devices" onClick={() => setMenuOpen(false)}>
            {t('layout.devices')}
          </NavLink>
          <NavLink to="/storage" onClick={() => setMenuOpen(false)}>
            {t('storage.title')}
          </NavLink>
          <NavLink to="/status" onClick={() => setMenuOpen(false)}>
            {t('layout.systemStatus')}
          </NavLink>
        </div>
        <NavLink to="/settings" onClick={() => setMenuOpen(false)}>
          {t('layout.serverSettings')}
        </NavLink>
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
        {version && <div style={{ marginTop: '0.75rem', fontSize: '0.75rem' }}>{t('layout.version', { version })}</div>}
      </div>
    </>
  )

  return (
    <div className="app-layout">
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b bg-card px-4 py-2 md:hidden">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('layout.openMenu')}
          aria-expanded={menuOpen}
          aria-controls={menuDrawerId}
          onClick={() => setMenuOpen(true)}
        >
          <Icon name="menu" size={22} />
        </Button>
        <h1 className="text-xl font-black tracking-[-0.5px] text-primary">{t('common.appName')}</h1>
      </header>
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent id={menuDrawerId} side="left" className="w-[min(20rem,85vw)]" closeLabel={t('layout.closeMenu')}>
          <SheetTitle className="sr-only">{t('layout.menu')}</SheetTitle>
          <div className="sidebar static h-full w-full overflow-y-auto border-r-0 p-5">
            {renderNav(`${operationsListId}-drawer`, false)}
          </div>
        </SheetContent>
      </Sheet>
      <aside className="sidebar max-md:hidden">{renderNav(`${operationsListId}-sidebar`, true)}</aside>
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
