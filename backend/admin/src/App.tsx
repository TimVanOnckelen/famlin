import { StoragePage } from './components/StoragePage'
import { useEffect, useState } from 'react'
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Layout } from './components/Layout'
import { LoginPage } from './components/LoginPage'
import { SetupPage } from './components/SetupPage'
import { GettingStartedPage } from './components/GettingStartedPage'
import { DashboardPage } from './components/DashboardPage'
import { UsersPage } from './components/UsersPage'
import { GroupsPage } from './components/GroupsPage'
import { ContentPage } from './components/ContentPage'
import { PushLogPage } from './components/PushLogPage'
import { ServerSettingsPage } from './components/ServerSettingsPage'
import { SystemStatusPage } from './components/SystemStatusPage'
import { DevicesPage } from './components/DevicesPage'
import { api, User } from './api/client'
import { StateMessage } from '@famlin/ui/common/state-message'

function App() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [user, setUser] = useState<User | null>(null)
  const [needsSetup, setNeedsSetup] = useState(false)
  const [loginNotice, setLoginNotice] = useState<string | undefined>()
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api
      .getSetupStatus()
      .then(({ needsSetup }) => {
        if (needsSetup) {
          setNeedsSetup(true)
          setLoading(false)
          return
        }

        const token = localStorage.getItem('famlin_admin_token')
        if (!token) {
          setLoading(false)
          return
        }

        api
          .getMe()
          .then((currentUser) => {
            if (currentUser.isAdmin) setUser(currentUser)
            else localStorage.removeItem('famlin_admin_token')
          })
          .catch(() => localStorage.removeItem('famlin_admin_token'))
          .finally(() => setLoading(false))
      })
      .catch(() => setLoading(false))
  }, [])

  if (loading) {
    return <StateMessage variant="loading">{t('common.loading')}</StateMessage>
  }

  if (needsSetup) {
    return (
      <SetupPage
        onSetupComplete={(newUser, restored) => {
          setNeedsSetup(false)
          setUser(newUser)
          // A fresh install continues into the guided wizard; a restore
          // already has its families and content.
          if (!restored) {
            try {
              localStorage.removeItem('famlin_admin_wizard_step')
            } catch {
              // ignore
            }
            navigate('/getting-started', { replace: true })
          }
        }}
        onRestoredWithAccounts={() => {
          // The backup brought back the old accounts: sign in with one of them.
          setNeedsSetup(false)
          setLoginNotice(t('setup.dumpRestored'))
        }}
      />
    )
  }

  if (!user?.isAdmin) {
    return <LoginPage onLogin={setUser} notice={loginNotice} />
  }

  return (
    <Layout user={user}>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/getting-started" element={<GettingStartedPage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/groups" element={<GroupsPage />} />
        <Route path="/content" element={<ContentPage />} />
        <Route path="/push-log" element={<PushLogPage />} />
        <Route path="/devices" element={<DevicesPage />} />
        <Route path="/settings" element={<ServerSettingsPage />} />
        <Route path="/storage" element={<StoragePage />} />
        <Route path="/status" element={<SystemStatusPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}

export default App
