import { Button } from '@famlin/ui/button'
import { Input } from '@famlin/ui/input'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api, type IntegrationSummary } from '../../api/client'
import { Icon } from '../Icon'
import { SecretInput } from '../settings/SecretInput'
import { SettingToggle } from '@famlin/ui/common/setting-toggle'
import { SettingsCard } from '../settings/SettingsCard'
import type { SettingsForm } from '../settings/useSettingsForm'

// The Connection tab of each integration. Every panel edits the server
// settings through the shared form (useSettingsForm) that the integration
// page wraps it in, so one save bar covers the tab.

type TestResult = { ok: boolean; message: string } | null

function TestRow({
  label,
  disabled,
  run,
}: {
  label: string
  disabled?: boolean
  run: () => Promise<{ ok: boolean; message: string }>
}) {
  const { t } = useTranslation()
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<TestResult>(null)
  return (
    <div className="settings-test-row">
      <Button
        variant="secondary"
        type="button"
        className="secondary"
        disabled={disabled || testing}
        onClick={async () => {
          setTesting(true)
          setResult(null)
          try {
            setResult(await run())
          } catch {
            setResult({ ok: false, message: t('integrations.testFailed') })
          } finally {
            setTesting(false)
          }
        }}
      >
        {testing ? t('integrations.testing') : label}
      </Button>
      {result &&
        (result.ok ? (
          <span className="test-ok">
            <Icon name="check" size={14} /> {result.message}
          </span>
        ) : (
          <span className="test-err">{result.message}</span>
        ))}
    </div>
  )
}

// The Immich key tests' failure, as a message.
function immichError(error: 'unreachable' | 'unauthorized', t: (key: string) => string) {
  return {
    ok: false,
    message:
      error === 'unauthorized' ? t('serverSettings.immichTestUnauthorized') : t('serverSettings.immichTestUnreachable'),
  }
}

// For integrations without a dedicated test endpoint: re-runs the server's
// connection checks against the saved settings.
function SavedCheckRow({ id, dirty, onChecked }: { id: 'email' | 'sso'; dirty: boolean; onChecked: () => void }) {
  const { t } = useTranslation()
  return (
    <>
      <TestRow
        label={t('integrations.checkSaved')}
        disabled={dirty}
        run={async () => {
          const summary = (await api.getIntegrations(true)).integrations.find((i) => i.id === id)
          onChecked()
          const check = summary?.check
          if (!check?.configured) return { ok: false, message: t('integrations.usage.notSetUp') }
          return check.ok
            ? { ok: true, message: t('integrations.checkOk') }
            : { ok: false, message: t(`systemStatus.integrations.errors.${check.error ?? 'unreachable'}`) }
        }}
      />
      {dirty && <p className="hint">{t('integrations.saveBeforeCheck')}</p>}
    </>
  )
}

export function ImmichConnection({ settingsForm }: { settingsForm: SettingsForm }) {
  const { t } = useTranslation()
  const { form, updateField, hasSecret } = settingsForm
  if (!form) return null
  return (
    <>
      <SettingsCard icon="image" title={t('integrations.immich.server')} desc={t('serverSettings.immichHint')}>
        <label>
          {t('serverSettings.immichServerUrl')}
          <Input
            id="immichServerUrl"
            type="url"
            value={form.immichServerUrl}
            onChange={(e) => updateField('immichServerUrl', e.target.value)}
            placeholder="https://immich.example.com"
          />
        </label>
        <label>
          {t('serverSettings.immichApiKey')}
          <SecretInput settingsForm={settingsForm} name="immichApiKey" destination="immichServerUrl" />
        </label>
        <TestRow
          key={`${form.immichServerUrl}|${form.immichApiKey}`}
          label={t('serverSettings.immichTestConnection')}
          disabled={!form.immichServerUrl || !hasSecret('immichApiKey')}
          run={async () => {
            const result = await api.testImmichConnection(form.immichServerUrl, form.immichApiKey ?? '')
            return result.ok ? { ok: true, message: t('serverSettings.immichTestOk') } : immichError(result.error, t)
          }}
        />
      </SettingsCard>
      <SettingsCard
        icon="rotate-ccw"
        title={t('integrations.immich.uploadKey')}
        desc={t('serverSettings.immichMirrorApiKeyHint')}
      >
        <label>
          {t('serverSettings.immichMirrorApiKey')}
          <SecretInput settingsForm={settingsForm} name="immichMirrorApiKey" destination="immichServerUrl" />
        </label>
        <TestRow
          key={`${form.immichServerUrl}|${form.immichMirrorApiKey}`}
          label={t('serverSettings.immichMirrorTest')}
          disabled={!form.immichServerUrl || !hasSecret('immichMirrorApiKey')}
          run={async () => {
            const result = await api.testImmichMirrorKey(form.immichServerUrl, form.immichMirrorApiKey ?? '')
            if (!result.ok) return immichError(result.error, t)
            if (result.missingScopes === null)
              return { ok: true, message: t('serverSettings.immichMirrorTestScopesUnknown') }
            if (result.missingScopes.length === 0) return { ok: true, message: t('serverSettings.immichMirrorTestOk') }
            return {
              ok: false,
              message: t('serverSettings.immichMirrorTestMissingScopes', { scopes: result.missingScopes.join(', ') }),
            }
          }}
        />
        <p className="hint">{t('integrations.immich.mirrorPerFamily')}</p>
      </SettingsCard>
    </>
  )
}

export function LocalConnection({ settingsForm }: { settingsForm: SettingsForm }) {
  const { t } = useTranslation()
  const { form, updateField } = settingsForm
  if (!form) return null
  return (
    <SettingsCard icon="folder" title={t('serverSettings.localMedia')} desc={t('serverSettings.localMediaHint')}>
      <label>
        {t('serverSettings.localMediaPath')}
        <Input
          id="localMediaPath"
          type="text"
          value={form.localMediaPath}
          onChange={(e) => updateField('localMediaPath', e.target.value)}
          placeholder="/media/family-photos"
        />
      </label>
      <TestRow
        key={form.localMediaPath}
        label={t('serverSettings.localMediaTest')}
        disabled={!form.localMediaPath}
        run={async () => {
          const result = await api.testLocalMediaPath(form.localMediaPath)
          if (result.ok) return { ok: true, message: t('serverSettings.localMediaTestOk') }
          return {
            ok: false,
            message:
              result.error === 'not_a_directory'
                ? t('serverSettings.localMediaTestNotADirectory')
                : t('serverSettings.localMediaTestNotFound'),
          }
        }}
      />
    </SettingsCard>
  )
}

export function SsoConnection({ settingsForm, onChecked }: { settingsForm: SettingsForm; onChecked: () => void }) {
  const { t } = useTranslation()
  const { form, updateField, dirty } = settingsForm
  if (!form) return null
  return (
    <SettingsCard icon="key" title={t('serverSettings.oidc')} desc={t('serverSettings.oidcHint')}>
      <label>
        {t('serverSettings.oidcName')}
        <Input
          id="oidcName"
          type="text"
          value={form.oidcName}
          onChange={(e) => updateField('oidcName', e.target.value)}
          placeholder="Authentik"
        />
      </label>
      <label>
        {t('serverSettings.oidcIssuer')}
        <Input
          id="oidcIssuer"
          type="text"
          value={form.oidcIssuer}
          onChange={(e) => updateField('oidcIssuer', e.target.value)}
          placeholder="https://auth.example.com/application/o/famlin/"
        />
      </label>
      <label>
        {t('serverSettings.oidcClientId')}
        <Input
          id="oidcClientId"
          type="text"
          value={form.oidcClientId}
          onChange={(e) => updateField('oidcClientId', e.target.value)}
        />
      </label>
      <label>
        {t('serverSettings.oidcClientSecret')}
        <SecretInput settingsForm={settingsForm} name="oidcClientSecret" destination="oidcIssuer" />
      </label>
      <p className="hint">{t('serverSettings.oidcClientSecretHint')}</p>
      <label>
        {t('serverSettings.oidcScopes')}
        <Input
          id="oidcScopes"
          type="text"
          value={form.oidcScopes}
          onChange={(e) => updateField('oidcScopes', e.target.value)}
          placeholder="openid email profile"
        />
      </label>
      <SavedCheckRow key={String(dirty)} id="sso" dirty={dirty} onChecked={onChecked} />
      <p className="hint">
        {t('integrations.sso.access')} <Link to="/settings?section=access">{t('integrations.sso.accessLink')}</Link>
      </p>
    </SettingsCard>
  )
}

export function AppleConnection({ settingsForm }: { settingsForm: SettingsForm }) {
  const { t } = useTranslation()
  const { form, updateField } = settingsForm
  if (!form) return null
  return (
    <SettingsCard icon="shield" title={t('integrations.names.apple')} desc={t('integrations.apple.desc')}>
      <label>
        {t('serverSettings.appleBundleIds')}
        <Input
          id="appleBundleIds"
          type="text"
          value={form.appleBundleIds}
          onChange={(e) => updateField('appleBundleIds', e.target.value)}
          placeholder="com.example.famlin"
        />
      </label>
      <p className="hint">{t('serverSettings.appleBundleIdsHint')}</p>
    </SettingsCard>
  )
}

export function EmailConnection({ settingsForm, onChecked }: { settingsForm: SettingsForm; onChecked: () => void }) {
  const { t } = useTranslation()
  const { form, updateField, dirty } = settingsForm
  if (!form) return null
  return (
    <>
      <SettingsCard icon="mail" title={t('serverSettings.emailSmtp')} desc={t('integrations.email.desc')}>
        <div className="row">
          <label style={{ flex: 2 }}>
            {t('serverSettings.smtpHost')}
            <Input
              id="smtpHost"
              type="text"
              value={form.smtpHost}
              onChange={(e) => updateField('smtpHost', e.target.value)}
              placeholder="smtp.example.com"
            />
          </label>
          <label style={{ flex: 1 }}>
            {t('serverSettings.port')}
            <Input
              id="smtpPort"
              type="number"
              value={form.smtpPort}
              onChange={(e) => updateField('smtpPort', parseInt(e.target.value, 10) || 0)}
            />
          </label>
        </div>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <label style={{ flex: 1 }}>
            {t('serverSettings.smtpUsername')}
            <Input
              id="smtpUser"
              type="text"
              value={form.smtpUser}
              onChange={(e) => updateField('smtpUser', e.target.value)}
            />
          </label>
          <label style={{ flex: 1 }}>
            {t('serverSettings.smtpPassword')}
            <SecretInput settingsForm={settingsForm} name="smtpPass" destination="smtpHost" />
          </label>
        </div>
        <label>
          {t('serverSettings.senderAddress')}
          <Input
            id="smtpFrom"
            type="email"
            value={form.smtpFrom}
            onChange={(e) => updateField('smtpFrom', e.target.value)}
            placeholder="Famlin <noreply@example.com>"
          />
        </label>
        <SavedCheckRow key={String(dirty)} id="email" dirty={dirty} onChecked={onChecked} />
      </SettingsCard>
      <SettingsCard icon="bell" title={t('integrations.email.usedFor')}>
        <SettingToggle
          title={t('serverSettings.emailEnabled')}
          hint={t('serverSettings.emailHint')}
          checked={form.emailNotificationsEnabled}
          onCheckedChange={(checked) => updateField('emailNotificationsEnabled', checked)}
        />
        <p className="hint">{t('integrations.email.alwaysUsed')}</p>
        <div className="status-row">
          <span>{t('serverSettings.publicUrl')}</span>
          {form.publicUrl ? (
            <code>{form.publicUrl}</code>
          ) : (
            <span className="test-err">{t('integrations.issues.publicUrlMissing')}</span>
          )}
        </div>
        <p className="hint">
          {t('integrations.email.publicUrl')} <Link to="/settings">{t('integrations.email.publicUrlLink')}</Link>
        </p>
      </SettingsCard>
    </>
  )
}

export function PushConnection({
  settingsForm,
  summary,
}: {
  settingsForm: SettingsForm
  summary: IntegrationSummary | null
}) {
  const { t } = useTranslation()
  const { form, updateField } = settingsForm
  if (!form) return null
  return (
    <SettingsCard icon="bell" title={t('serverSettings.push')} desc={t('integrations.push.desc')}>
      <SettingToggle
        title={t('serverSettings.pushEnabled')}
        hint={t('serverSettings.pushHint')}
        checked={form.pushNotificationsEnabled}
        onCheckedChange={(checked) => updateField('pushNotificationsEnabled', checked)}
      />
      <div className="status-row">
        <span>{t('integrations.push.devices')}</span>
        <span>{summary ? String(summary.usage.devices ?? 0) : '—'}</span>
      </div>
    </SettingsCard>
  )
}
