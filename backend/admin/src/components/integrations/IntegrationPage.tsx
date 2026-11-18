import { PageHeader } from '@famlin/ui/common/page-header'
import { StateMessage } from '@famlin/ui/common/state-message'
import { Tabs, TabsList, TabsTrigger } from '@famlin/ui/tabs'
import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api, type IntegrationId, type IntegrationSummary, type User } from '../../api/client'
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
// Everything but the settings form comes from the overview summary.
export function IntegrationPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { id: rawId, tab } = useParams()
  const id = isIntegrationId(rawId) ? rawId : null
  const [summary, setSummary] = useState<IntegrationSummary | null>(null)
  const [summaryError, setSummaryError] = useState('')

  const reload = useCallback(
    (check = false) => {
      if (!id) return
      api
        .getIntegrations(check)
        .then((overview) => {
          setSummary(overview.integrations.find((i) => i.id === id) ?? null)
          setSummaryError('')
        })
        .catch((err) => setSummaryError(err instanceof Error ? err.message : t('common.error')))
    },
    [id, t]
  )

  useEffect(() => {
    reload()
  }, [reload])

  if (!id) return <Navigate to="/integrations" replace />
  const meta = INTEGRATIONS[id]
  // The Connection tab lives at the integration's own URL.
  if (tab === 'connection') return <Navigate to={`/integrations/${id}`} replace />
  const active = (tab ?? 'connection') as IntegrationTab
  if (!meta.tabs.includes(active)) return <Navigate to={`/integrations/${id}`} replace />

  const needsSummary = (content: React.ReactNode) =>
    summaryError ? (
      <StateMessage variant="error">{summaryError}</StateMessage>
    ) : summary ? (
      content
    ) : (
      <StateMessage variant="loading">{t('common.loading')}</StateMessage>
    )

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
        <Tabs
          value={active}
          onValueChange={(value) =>
            navigate(value === 'connection' ? `/integrations/${id}` : `/integrations/${id}/${value}`)
          }
          className="integration-tabs"
        >
          <TabsList variant="line" aria-label={t(`integrations.names.${id}`)}>
            {meta.tabs.map((name) => (
              <TabsTrigger key={name} value={name}>
                {t(`integrations.tabs.${name}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}
      <div className="integration-tab-body">
        {active === 'connection' &&
          (id === 'storage' ? <StoragePage embedded /> : <ConnectionTab id={id} summary={summary} onChange={reload} />)}
        {active === 'families' &&
          (id === 'immich' || id === 'local') &&
          needsSummary(<FamiliesTab provider={id} families={summary?.families ?? []} onChange={() => reload()} />)}
        {active === 'people' && <PeopleTab />}
        {active === 'activity' && needsSummary(summary && <ActivityTab summary={summary} />)}
      </div>
    </>
  )
}

// Its own component so the settings are only loaded on this tab. The form
// never waits for the summary: when the status can't load is exactly when an
// admin needs to fix the settings.
function ConnectionTab({
  id,
  summary,
  onChange,
}: {
  id: Exclude<IntegrationId, 'storage'>
  summary: IntegrationSummary | null
  onChange: (check?: boolean) => void
}) {
  const { t } = useTranslation()
  // A save clears the server's cached checks; reload the status with fresh ones.
  const settingsForm = useSettingsForm(() => onChange())
  if (settingsForm.loadError) return <StateMessage variant="error">{settingsForm.loadError}</StateMessage>
  if (!settingsForm.form) return <StateMessage variant="loading">{t('common.loading')}</StateMessage>
  const checked = () => onChange()
  const panel = {
    immich: <ImmichConnection settingsForm={settingsForm} />,
    local: <LocalConnection settingsForm={settingsForm} />,
    sso: <SsoConnection settingsForm={settingsForm} onChecked={checked} />,
    apple: <AppleConnection settingsForm={settingsForm} />,
    email: <EmailConnection settingsForm={settingsForm} onChecked={checked} />,
    push: <PushConnection settingsForm={settingsForm} summary={summary} />,
  }[id]
  return (
    <form onSubmit={settingsForm.save} className="settings-form">
      {panel}
      <SettingsSaveBar settingsForm={settingsForm} />
    </form>
  )
}

function PeopleTab() {
  const [users, setUsers] = useState<User[]>([])
  useEffect(() => {
    api
      .getAllUsers()
      .then(setUsers)
      .catch(() => setUsers([]))
  }, [])
  return <PeopleMappingSection users={users} />
}
