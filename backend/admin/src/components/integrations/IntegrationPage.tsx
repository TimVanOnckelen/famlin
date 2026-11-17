import { PageHeader } from '@famlin/ui/common/page-header'
import { StateMessage } from '@famlin/ui/common/state-message'
import { useEffect, useState } from 'react'
import { Link, Navigate, NavLink, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api, type IntegrationSummary, type User } from '../../api/client'
import { Icon } from '../Icon'
import { PeopleMappingSection } from '../PeopleMappingSection'
import { StoragePage } from '../StoragePage'
import { SettingsSaveBar } from '../settings/SettingsSaveBar'
import { useSettingsForm } from '../settings/useSettingsForm'
import { ActivityTab } from './ActivityTab'
import {
  AppleConnection,
  EmailConnection,
  ImmichConnection,
  LocalConnection,
  PushConnection,
  SsoConnection,
} from './connections'
import { FamiliesTab } from './FamiliesTab'
import { INTEGRATIONS, isIntegrationId, type IntegrationTab } from './registry'
import { StateChip } from './StateChip'

// One integration's page: the same tabs for every integration (Connection,
// Families where it's assigned per family, People for Immich, Activity).
export function IntegrationPage() {
  const { t } = useTranslation()
  const { id: rawId, tab } = useParams()
  const id = isIntegrationId(rawId) ? rawId : null
  const [summary, setSummary] = useState<IntegrationSummary | null>(null)
  const [users, setUsers] = useState<User[]>([])
  const settingsForm = useSettingsForm()

  useEffect(() => {
    if (!id) return
    api
      .getIntegrations()
      .then((overview) => setSummary(overview.integrations.find((i) => i.id === id) ?? null))
      .catch(() => setSummary(null))
    if (id === 'immich')
      api
        .getAllUsers()
        .then(setUsers)
        .catch(() => setUsers([]))
  }, [id])

  if (!id) return <Navigate to="/integrations" replace />
  const meta = INTEGRATIONS[id]
  const active = (tab ?? 'connection') as IntegrationTab
  if (!meta.tabs.includes(active)) return <Navigate to={`/integrations/${id}`} replace />

  const connection = () => {
    if (id === 'storage') return <StoragePage embedded />
    if (settingsForm.loadError) return <StateMessage variant="error">{settingsForm.loadError}</StateMessage>
    if (!settingsForm.form || !summary) return <StateMessage variant="loading">{t('common.loading')}</StateMessage>
    const panel = {
      immich: <ImmichConnection settingsForm={settingsForm} />,
      local: <LocalConnection settingsForm={settingsForm} />,
      sso: <SsoConnection settingsForm={settingsForm} />,
      apple: <AppleConnection settingsForm={settingsForm} />,
      email: <EmailConnection settingsForm={settingsForm} />,
      push: <PushConnection settingsForm={settingsForm} summary={summary} />,
    }[id]
    return (
      <form onSubmit={settingsForm.save} className="settings-form">
        {panel}
        <SettingsSaveBar settingsForm={settingsForm} />
      </form>
    )
  }

  return (
    <>
      <Link to="/integrations" className="integration-back">
        <Icon name="chevron-right" size={14} /> {t('integrations.title')}
      </Link>
      <PageHeader title={t(`integrations.names.${id}`)} actions={summary && <StateChip state={summary.state} />} />
      {summary && summary.issues.length > 0 && (
        <ul className={`integration-issues ${summary.state}`}>
          {summary.issues.map((issue) => (
            <li key={issue}>{t(`integrations.issues.${issue}`)}</li>
          ))}
        </ul>
      )}
      {meta.tabs.length > 1 && (
        <nav className="integration-tabs" aria-label={t(`integrations.names.${id}`)}>
          {meta.tabs.map((name) => (
            <NavLink key={name} to={name === 'connection' ? `/integrations/${id}` : `/integrations/${id}/${name}`} end>
              {t(`integrations.tabs.${name}`)}
            </NavLink>
          ))}
        </nav>
      )}
      <div className="integration-tab-body">
        {active === 'connection' && connection()}
        {active === 'families' && (id === 'immich' || id === 'local') && <FamiliesTab provider={id} />}
        {active === 'people' && <PeopleMappingSection users={users} />}
        {active === 'activity' && summary && <ActivityTab summary={summary} />}
      </div>
    </>
  )
}
