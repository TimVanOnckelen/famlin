import { SaveBar } from '@famlin/ui/common/save-bar'
import { StateMessage } from '@famlin/ui/common/state-message'
import { PageHeader } from '@famlin/ui/common/page-header'
import { Badge } from '@famlin/ui/badge'
import { Button } from '@famlin/ui/button'
import { SelectField } from '@famlin/ui/common/select-field'
import { Input } from '@famlin/ui/input'
import { SettingToggle } from '@famlin/ui/common/setting-toggle'
import { SectionCard } from '@famlin/ui/common/section-card'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api, ServerSettings, User } from '../api/client'
import { LANGUAGE_NAMES, SUPPORTED_LANGUAGES, type SupportedLanguage } from '../i18n'
import { Icon, IconName } from './Icon'
import { PeopleMappingSection } from './PeopleMappingSection'
import { BrandingSection } from './BrandingSection'

const BACKUP_DOCS_URL = 'https://famlin.app/docs/maintenance#keep-backups-off-the-machine'

type SectionId = 'general' | 'branding' | 'signin' | 'notifications' | 'media' | 'backups'

interface SettingsCardProps {
  icon: IconName
  title: string
  desc?: string
  badge?: React.ReactNode
  children: React.ReactNode
}

function SettingsCard({ icon, title, desc, badge, children }: SettingsCardProps) {
  return (
    <SectionCard title={title} icon={<Icon name={icon} size={20} />} description={desc} badge={badge}>
      {children}
    </SectionCard>
  )
}

interface ToggleRowProps {
  title: string
  hint: string
  checked: boolean
  onChange: (checked: boolean) => void
}

function ToggleRow({ title, hint, checked, onChange }: ToggleRowProps) {
  return <SettingToggle title={title} hint={hint} checked={checked} onCheckedChange={onChange} />
}

export function ServerSettingsPage() {
  const { t } = useTranslation()
  const [settings, setSettings] = useState<ServerSettings | null>(null)
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [activeSection, setActiveSection] = useState<SectionId>('general')

  const [form, setForm] = useState<ServerSettings>({
    defaultLanguage: 'en',
    appStoreUrl: '',
    playStoreUrl: '',
    publicUrl: '',
    allowedEmails: [],
    oidcName: '',
    oidcIssuer: '',
    oidcClientId: '',
    oidcClientSecret: '',
    oidcScopes: '',
    appleBundleIds: '',
    smtpHost: '',
    smtpPort: 587,
    smtpUser: '',
    smtpPass: '',
    smtpFrom: '',
    pushNotificationsEnabled: true,
    emailNotificationsEnabled: true,
    immichServerUrl: '',
    immichApiKey: '',
    localMediaPath: '',
    updateCheckEnabled: true,
    backupIncludeMedia: true,
    backupEnabled: false,
    backupSchedule: 'daily',
    backupHour: 3,
    backupRetention: 7,
  })

  const [testingImmich, setTestingImmich] = useState(false)
  const [immichTestResult, setImmichTestResult] = useState<'ok' | 'unreachable' | 'unauthorized' | null>(null)
  const [testingLocalMedia, setTestingLocalMedia] = useState(false)
  const [localMediaTestResult, setLocalMediaTestResult] = useState<'ok' | 'not_found' | 'not_a_directory' | null>(null)

  const [exporting, setExporting] = useState(false)
  const [exportIncludeMedia, setExportIncludeMedia] = useState(true)
  const [exportError, setExportError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      api.getSettings().then((s) => {
        setSettings(s)
        setForm(s)
      }),
      api.getAllUsers().then(setUsers),
    ])
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!success) return
    const timer = setTimeout(() => setSuccess(false), 4000)
    return () => clearTimeout(timer)
  }, [success])

  const dirty = useMemo(() => settings !== null && JSON.stringify(form) !== JSON.stringify(settings), [form, settings])

  const updateField = <K extends keyof ServerSettings>(key: K, value: ServerSettings[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    setSuccess(false)
  }

  const parseList = (value: string) =>
    value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)

  const handleTestImmich = async () => {
    setTestingImmich(true)
    setImmichTestResult(null)
    try {
      const result = await api.testImmichConnection(form.immichServerUrl, form.immichApiKey)
      setImmichTestResult(result.ok ? 'ok' : result.error)
    } catch {
      setImmichTestResult('unreachable')
    } finally {
      setTestingImmich(false)
    }
  }

  const handleTestLocalMedia = async () => {
    setTestingLocalMedia(true)
    setLocalMediaTestResult(null)
    try {
      const result = await api.testLocalMediaPath(form.localMediaPath)
      setLocalMediaTestResult(result.ok ? 'ok' : result.error)
    } catch {
      setLocalMediaTestResult('not_found')
    } finally {
      setTestingLocalMedia(false)
    }
  }

  const handleExport = async () => {
    setExporting(true)
    setExportError(null)
    try {
      const { blob, filename } = await api.downloadExport(exportIncludeMedia)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch (err: any) {
      setExportError(err.message)
    } finally {
      setExporting(false)
    }
  }

  const handleDiscard = () => {
    if (settings) setForm(settings)
    setError(null)
    setSuccess(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setSuccess(false)

    try {
      const updated = await api.updateSettings(form)
      setSettings(updated)
      setForm(updated)
      setSuccess(true)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading)
    return (
      <StateMessage variant="loading" className="loading">
        {t('common.loading')}
      </StateMessage>
    )
  if (error && !settings)
    return (
      <StateMessage variant="error" className="error">
        {error}
      </StateMessage>
    )

  const oidcConfigured = Boolean(form.oidcIssuer && form.oidcClientId)
  const immichConfigured = Boolean(form.immichServerUrl && form.immichApiKey)
  const localConfigured = Boolean(form.localMediaPath)
  const anyChannelEnabled = form.pushNotificationsEnabled || form.emailNotificationsEnabled
  const languageName = LANGUAGE_NAMES[form.defaultLanguage as SupportedLanguage] ?? form.defaultLanguage

  const configuredBadge = (ok: boolean) => (
    <Badge variant={ok ? 'success' : 'outline'}>
      {ok ? t('serverSettings.statusConfigured') : t('serverSettings.statusNotConfigured')}
    </Badge>
  )
  const enabledBadge = (ok: boolean) => (
    <Badge variant={ok ? 'success' : 'outline'}>
      {ok ? t('serverSettings.statusEnabled') : t('serverSettings.statusDisabled')}
    </Badge>
  )

  const sections: {
    id: SectionId
    icon: IconName
    label: string
    status: { ok?: boolean; label: string }
  }[] = [
    {
      id: 'general',
      icon: 'globe',
      label: t('serverSettings.general'),
      status: { label: languageName },
    },
    {
      id: 'branding',
      icon: 'palette',
      label: t('branding.title'),
      status: { label: t('branding.navStatus') },
    },
    {
      id: 'signin',
      icon: 'key',
      label: t('serverSettings.signInAccess'),
      status: {
        ok: oidcConfigured,
        label: oidcConfigured ? t('serverSettings.statusConfigured') : t('serverSettings.statusNotConfigured'),
      },
    },
    {
      id: 'notifications',
      icon: 'bell',
      label: t('serverSettings.notifications'),
      status: {
        ok: anyChannelEnabled,
        label: anyChannelEnabled ? t('serverSettings.statusEnabled') : t('serverSettings.statusDisabled'),
      },
    },
    {
      id: 'media',
      icon: 'image',
      label: t('serverSettings.media'),
      status: {
        ok: immichConfigured || localConfigured,
        label:
          immichConfigured || localConfigured
            ? t('serverSettings.statusConfigured')
            : t('serverSettings.statusNotConfigured'),
      },
    },
    {
      id: 'backups',
      icon: 'clock',
      label: t('serverSettings.backups'),
      status: {
        ok: form.backupEnabled,
        label: form.backupEnabled ? t('serverSettings.statusEnabled') : t('serverSettings.statusDisabled'),
      },
    },
  ]

  return (
    <>
      <PageHeader title={t('serverSettings.title')} />

      <div className="settings-layout">
        <nav className="settings-nav" aria-label={t('serverSettings.title')}>
          {sections.map((section) => (
            <Button
              variant="ghost"
              key={section.id}
              type="button"
              className={`h-auto justify-start whitespace-normal rounded-sm px-3 py-3 settings-nav-item${activeSection === section.id ? ' active' : ''}`}
              onClick={() => setActiveSection(section.id)}
            >
              <span className="settings-nav-icon">
                <Icon name={section.icon} size={15} />
              </span>
              <span className="settings-nav-text">
                <span className="settings-nav-label">{section.label}</span>
                <span className="settings-nav-status">
                  {section.status.ok !== undefined && (
                    <span className={`status-dot ${section.status.ok ? 'ok' : 'off'}`} />
                  )}
                  {section.status.label}
                </span>
              </span>
            </Button>
          ))}
        </nav>

        <div className="settings-content">
          {/* Branding saves through its own validated endpoint, so it lives
              outside the generic settings form (and its save bar). */}
          {activeSection === 'branding' && (
            <div className="settings-form">
              <SettingsCard icon="palette" title={t('branding.title')} desc={t('branding.desc')}>
                <BrandingSection />
              </SettingsCard>
            </div>
          )}
          <form onSubmit={handleSubmit} className="settings-form" hidden={activeSection === 'branding'}>
            {activeSection === 'general' && (
              <SettingsCard icon="globe" title={t('serverSettings.general')} desc={t('serverSettings.generalDesc')}>
                <label>
                  {t('serverSettings.defaultLanguage')}
                  <SelectField
                    value={form.defaultLanguage}
                    onValueChange={(value) => updateField('defaultLanguage', value)}
                    items={[
                      ...SUPPORTED_LANGUAGES.map((lang) => ({ value: lang, label: <>{LANGUAGE_NAMES[lang]}</> })),
                    ]}
                  />
                </label>
                <p className="hint">{t('serverSettings.defaultLanguageHint')}</p>
                <label>
                  {t('serverSettings.publicUrl')}
                  <Input
                    type="url"
                    value={form.publicUrl}
                    onChange={(e) => updateField('publicUrl', e.target.value)}
                    placeholder="https://famlin.example.com"
                  />
                </label>
                {form.publicUrl !== window.location.origin && (
                  <div className="settings-test-row">
                    <Button
                      variant="secondary"
                      type="button"
                      className="secondary"
                      onClick={() => updateField('publicUrl', window.location.origin)}
                    >
                      {t('serverSettings.publicUrlUseCurrent', { url: window.location.origin })}
                    </Button>
                  </div>
                )}
                <p className="hint">{t('serverSettings.publicUrlHint')}</p>
                <div className="row">
                  <label style={{ flex: 1 }}>
                    {t('serverSettings.appStoreUrl')}
                    <Input
                      type="url"
                      value={form.appStoreUrl}
                      onChange={(e) => updateField('appStoreUrl', e.target.value)}
                      placeholder="https://apps.apple.com/app/..."
                    />
                  </label>
                  <label style={{ flex: 1 }}>
                    {t('serverSettings.playStoreUrl')}
                    <Input
                      type="url"
                      value={form.playStoreUrl}
                      onChange={(e) => updateField('playStoreUrl', e.target.value)}
                      placeholder="https://play.google.com/store/apps/details?id=..."
                    />
                  </label>
                </div>
                <p className="hint">{t('serverSettings.storeUrlsHint')}</p>
              </SettingsCard>
            )}

            {activeSection === 'general' && (
              <SettingsCard icon="bell" title={t('serverSettings.updates')}>
                <ToggleRow
                  title={t('serverSettings.updateCheck')}
                  hint={t('serverSettings.updateCheckHint')}
                  checked={form.updateCheckEnabled}
                  onChange={(checked) => updateField('updateCheckEnabled', checked)}
                />
              </SettingsCard>
            )}

            {activeSection === 'general' && (
              <SettingsCard
                icon="download"
                title={t('serverSettings.dataExport')}
                desc={t('serverSettings.dataExportDesc')}
              >
                <div className="settings-test-row">
                  <ToggleRow
                    title={t('serverSettings.exportIncludeMedia')}
                    hint={t('serverSettings.exportIncludeMediaHint')}
                    checked={exportIncludeMedia}
                    onChange={setExportIncludeMedia}
                  />
                  <Button
                    variant="secondary"
                    type="button"
                    className="secondary"
                    onClick={handleExport}
                    disabled={exporting}
                  >
                    {exporting ? t('serverSettings.dataExportDownloading') : t('serverSettings.dataExportDownload')}
                  </Button>
                </div>
                {exportError && <p className="test-err">{exportError}</p>}
              </SettingsCard>
            )}

            {activeSection === 'signin' && (
              <>
                <SettingsCard
                  icon="key"
                  title={t('serverSettings.oidc')}
                  desc={t('serverSettings.oidcHint')}
                  badge={configuredBadge(oidcConfigured)}
                >
                  <label>
                    {t('serverSettings.oidcName')}
                    <Input
                      type="text"
                      value={form.oidcName}
                      onChange={(e) => updateField('oidcName', e.target.value)}
                      placeholder="Authentik"
                    />
                  </label>
                  <label>
                    {t('serverSettings.oidcIssuer')}
                    <Input
                      type="text"
                      value={form.oidcIssuer}
                      onChange={(e) => updateField('oidcIssuer', e.target.value)}
                      placeholder="https://auth.example.com/application/o/famlin/"
                    />
                  </label>
                  <label>
                    {t('serverSettings.oidcClientId')}
                    <Input
                      type="text"
                      value={form.oidcClientId}
                      onChange={(e) => updateField('oidcClientId', e.target.value)}
                    />
                  </label>
                  <label>
                    {t('serverSettings.oidcClientSecret')}
                    <Input
                      type="password"
                      value={form.oidcClientSecret}
                      onChange={(e) => updateField('oidcClientSecret', e.target.value)}
                    />
                  </label>
                  <p className="hint">{t('serverSettings.oidcClientSecretHint')}</p>
                  <label>
                    {t('serverSettings.oidcScopes')}
                    <Input
                      type="text"
                      value={form.oidcScopes}
                      onChange={(e) => updateField('oidcScopes', e.target.value)}
                      placeholder="openid email profile"
                    />
                  </label>
                  <label>
                    {t('serverSettings.appleBundleIds')}
                    <Input
                      type="text"
                      value={form.appleBundleIds}
                      onChange={(e) => updateField('appleBundleIds', e.target.value)}
                      placeholder="com.example.famlin"
                    />
                  </label>
                  <p className="hint">{t('serverSettings.appleBundleIdsHint')}</p>
                </SettingsCard>

                <SettingsCard icon="shield" title={t('serverSettings.accessControl')}>
                  <label>
                    {t('serverSettings.allowedEmails')}
                    <Input
                      type="text"
                      value={form.allowedEmails.join(', ')}
                      onChange={(e) => updateField('allowedEmails', parseList(e.target.value))}
                      placeholder="family@example.com"
                    />
                  </label>
                  <p className="hint">{t('serverSettings.allowedEmailsHint')}</p>
                </SettingsCard>
              </>
            )}

            {activeSection === 'notifications' && (
              <>
                <SettingsCard
                  icon="bell"
                  title={t('serverSettings.push')}
                  badge={enabledBadge(form.pushNotificationsEnabled)}
                >
                  <ToggleRow
                    title={t('serverSettings.pushEnabled')}
                    hint={t('serverSettings.pushHint')}
                    checked={form.pushNotificationsEnabled}
                    onChange={(checked) => updateField('pushNotificationsEnabled', checked)}
                  />
                </SettingsCard>

                <SettingsCard
                  icon="mail"
                  title={t('serverSettings.emailSmtp')}
                  badge={enabledBadge(form.emailNotificationsEnabled)}
                >
                  <ToggleRow
                    title={t('serverSettings.emailEnabled')}
                    hint={t('serverSettings.emailHint')}
                    checked={form.emailNotificationsEnabled}
                    onChange={(checked) => updateField('emailNotificationsEnabled', checked)}
                  />
                  <div className="row">
                    <label style={{ flex: 2 }}>
                      {t('serverSettings.smtpHost')}
                      <Input
                        type="text"
                        value={form.smtpHost}
                        onChange={(e) => updateField('smtpHost', e.target.value)}
                        placeholder="smtp.example.com"
                      />
                    </label>
                    <label style={{ flex: 1 }}>
                      {t('serverSettings.port')}
                      <Input
                        type="number"
                        value={form.smtpPort}
                        onChange={(e) => updateField('smtpPort', parseInt(e.target.value, 10) || 0)}
                      />
                    </label>
                  </div>
                  <div className="row">
                    <label style={{ flex: 1 }}>
                      {t('serverSettings.smtpUsername')}
                      <Input
                        type="text"
                        value={form.smtpUser}
                        onChange={(e) => updateField('smtpUser', e.target.value)}
                      />
                    </label>
                    <label style={{ flex: 1 }}>
                      {t('serverSettings.smtpPassword')}
                      <Input
                        type="password"
                        value={form.smtpPass}
                        onChange={(e) => updateField('smtpPass', e.target.value)}
                      />
                    </label>
                  </div>
                  <label>
                    {t('serverSettings.senderAddress')}
                    <Input
                      type="email"
                      value={form.smtpFrom}
                      onChange={(e) => updateField('smtpFrom', e.target.value)}
                      placeholder="Famlin <noreply@example.com>"
                    />
                  </label>
                </SettingsCard>
              </>
            )}

            {activeSection === 'media' && (
              <>
                <p className="settings-intro">{t('serverSettings.integrationsHint')}</p>

                <SettingsCard
                  icon="image"
                  title={t('serverSettings.immich')}
                  desc={t('serverSettings.immichHint')}
                  badge={configuredBadge(immichConfigured)}
                >
                  <label>
                    {t('serverSettings.immichServerUrl')}
                    <Input
                      type="url"
                      value={form.immichServerUrl}
                      onChange={(e) => {
                        updateField('immichServerUrl', e.target.value)
                        setImmichTestResult(null)
                      }}
                      placeholder="https://immich.example.com"
                    />
                  </label>
                  <label>
                    {t('serverSettings.immichApiKey')}
                    <Input
                      type="password"
                      value={form.immichApiKey}
                      onChange={(e) => {
                        updateField('immichApiKey', e.target.value)
                        setImmichTestResult(null)
                      }}
                    />
                  </label>
                  <div className="settings-test-row">
                    <Button
                      variant="secondary"
                      type="button"
                      className="secondary"
                      onClick={handleTestImmich}
                      disabled={testingImmich || !form.immichServerUrl || !form.immichApiKey}
                    >
                      {testingImmich ? t('serverSettings.immichTesting') : t('serverSettings.immichTestConnection')}
                    </Button>
                    {immichTestResult === 'ok' && (
                      <span className="test-ok">
                        <Icon name="check" size={14} /> {t('serverSettings.immichTestOk')}
                      </span>
                    )}
                    {immichTestResult === 'unauthorized' && (
                      <span className="test-err">{t('serverSettings.immichTestUnauthorized')}</span>
                    )}
                    {immichTestResult === 'unreachable' && (
                      <span className="test-err">{t('serverSettings.immichTestUnreachable')}</span>
                    )}
                  </div>
                  <div className="settings-subsection">
                    <PeopleMappingSection users={users} />
                  </div>
                </SettingsCard>

                <SettingsCard
                  icon="folder"
                  title={t('serverSettings.localMedia')}
                  desc={t('serverSettings.localMediaHint')}
                  badge={configuredBadge(localConfigured)}
                >
                  <label>
                    {t('serverSettings.localMediaPath')}
                    <Input
                      type="text"
                      value={form.localMediaPath}
                      onChange={(e) => {
                        updateField('localMediaPath', e.target.value)
                        setLocalMediaTestResult(null)
                      }}
                      placeholder="/media/family-photos"
                    />
                  </label>
                  <div className="settings-test-row">
                    <Button
                      variant="secondary"
                      type="button"
                      className="secondary"
                      onClick={handleTestLocalMedia}
                      disabled={testingLocalMedia || !form.localMediaPath}
                    >
                      {testingLocalMedia ? t('serverSettings.localMediaTesting') : t('serverSettings.localMediaTest')}
                    </Button>
                    {localMediaTestResult === 'ok' && (
                      <span className="test-ok">
                        <Icon name="check" size={14} /> {t('serverSettings.localMediaTestOk')}
                      </span>
                    )}
                    {localMediaTestResult === 'not_found' && (
                      <span className="test-err">{t('serverSettings.localMediaTestNotFound')}</span>
                    )}
                    {localMediaTestResult === 'not_a_directory' && (
                      <span className="test-err">{t('serverSettings.localMediaTestNotADirectory')}</span>
                    )}
                  </div>
                </SettingsCard>
              </>
            )}

            {activeSection === 'backups' && (
              <SettingsCard
                icon="clock"
                title={t('serverSettings.backups')}
                desc={t('serverSettings.backupsDesc')}
                badge={enabledBadge(form.backupEnabled)}
              >
                <ToggleRow
                  title={t('serverSettings.backupEnabled')}
                  hint={t('serverSettings.backupEnabledHint')}
                  checked={form.backupEnabled}
                  onChange={(checked) => updateField('backupEnabled', checked)}
                />
                <p className="muted">
                  {t('serverSettings.backupOffsiteHint')}{' '}
                  <a href={BACKUP_DOCS_URL} target="_blank" rel="noreferrer">
                    {t('serverSettings.backupOffsiteLink')}
                  </a>
                </p>
                <ToggleRow
                  title={t('serverSettings.backupIncludeMedia')}
                  hint={t('serverSettings.backupIncludeMediaHint')}
                  checked={form.backupIncludeMedia}
                  onChange={(checked) => updateField('backupIncludeMedia', checked)}
                />
                <div className="row">
                  <label style={{ flex: 1 }}>
                    {t('serverSettings.backupSchedule')}
                    <SelectField
                      value={form.backupSchedule}
                      onValueChange={(value) =>
                        updateField('backupSchedule', value as ServerSettings['backupSchedule'])
                      }
                      items={[
                        { value: 'daily', label: <>{t('serverSettings.backupScheduleDaily')}</> },
                        { value: 'weekly', label: <>{t('serverSettings.backupScheduleWeekly')}</> },
                      ]}
                    />
                  </label>
                  <label style={{ flex: 1 }}>
                    {t('serverSettings.backupHour')}
                    <SelectField
                      value={form.backupHour}
                      onValueChange={(value) => updateField('backupHour', Number(value))}
                      items={[
                        ...Array.from({ length: 24 }, (_, hour) => ({
                          value: hour,
                          label: <>{`${String(hour).padStart(2, '0')}:00`}</>,
                        })),
                      ]}
                    />
                  </label>
                  <label style={{ flex: 1 }}>
                    {t('serverSettings.backupRetention')}
                    <Input
                      type="number"
                      min={1}
                      max={365}
                      value={form.backupRetention}
                      onChange={(e) => updateField('backupRetention', Math.max(1, Number(e.target.value) || 1))}
                    />
                  </label>
                </div>
                <p className="hint">{t('serverSettings.backupHint')}</p>
                <p className="hint">
                  <Link to="/status">{t('serverSettings.backupStatusLink')}</Link>
                </p>
              </SettingsCard>
            )}

            {(dirty || success || error) && (
              <SaveBar
                actions={
                  <>
                    {dirty && (
                      <Button
                        variant="secondary"
                        type="button"
                        className="secondary"
                        onClick={handleDiscard}
                        disabled={saving}
                      >
                        {t('serverSettings.discard')}
                      </Button>
                    )}
                    <Button type="submit" disabled={saving || !dirty}>
                      {saving ? t('serverSettings.saving') : t('serverSettings.saveSettings')}
                    </Button>
                  </>
                }
              >
                <span className={`save-bar-msg${error ? ' err' : success ? ' ok' : ''}`}>
                  {error ? (
                    error
                  ) : success ? (
                    <>
                      <Icon name="check" size={15} /> {t('serverSettings.saved')}
                    </>
                  ) : (
                    t('serverSettings.unsavedChanges')
                  )}
                </span>
              </SaveBar>
            )}
          </form>
        </div>
      </div>
    </>
  )
}
