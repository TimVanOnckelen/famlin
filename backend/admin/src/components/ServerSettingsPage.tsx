import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ServerSettings, User } from '../api/client';
import { SUPPORTED_LANGUAGES } from '../i18n';
import { Icon, IconName } from './Icon';
import { PeopleMappingSection } from './PeopleMappingSection';

type SectionId = 'general' | 'signin' | 'notifications' | 'media';

interface SettingsCardProps {
  icon: IconName;
  title: string;
  desc?: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}

function SettingsCard({ icon, title, desc, badge, children }: SettingsCardProps) {
  return (
    <section className="card">
      <div className="settings-card-header">
        <span className="settings-card-icon">
          <Icon name={icon} size={17} />
        </span>
        <div className="settings-card-heading">
          <h3>{title}</h3>
          {desc && <p className="settings-card-desc">{desc}</p>}
        </div>
        {badge}
      </div>
      <div className="settings-fields">{children}</div>
    </section>
  );
}

interface ToggleRowProps {
  title: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function ToggleRow({ title, hint, checked, onChange }: ToggleRowProps) {
  return (
    <label className="toggle-row">
      <span className="toggle-row-text">
        <span className="toggle-row-title">{title}</span>
        <span className="toggle-row-hint">{hint}</span>
      </span>
      <span className="switch">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="switch-slider" />
      </span>
    </label>
  );
}

export function ServerSettingsPage() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<ServerSettings | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [activeSection, setActiveSection] = useState<SectionId>('general');

  const [form, setForm] = useState<ServerSettings>({
    defaultLanguage: 'en',
    appStoreUrl: '',
    playStoreUrl: '',
    allowedEmails: [],
    oidcName: '',
    oidcIssuer: '',
    oidcClientId: '',
    oidcClientSecret: '',
    oidcScopes: '',
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
  });

  const [testingImmich, setTestingImmich] = useState(false);
  const [immichTestResult, setImmichTestResult] = useState<'ok' | 'unreachable' | 'unauthorized' | null>(null);
  const [testingLocalMedia, setTestingLocalMedia] = useState(false);
  const [localMediaTestResult, setLocalMediaTestResult] = useState<'ok' | 'not_found' | 'not_a_directory' | null>(null);

  useEffect(() => {
    Promise.all([
      api.getSettings().then((s) => {
        setSettings(s);
        setForm(s);
      }),
      api.getAllUsers().then(setUsers),
    ])
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => setSuccess(false), 4000);
    return () => clearTimeout(timer);
  }, [success]);

  const dirty = useMemo(
    () => settings !== null && JSON.stringify(form) !== JSON.stringify(settings),
    [form, settings]
  );

  const updateField = <K extends keyof ServerSettings>(key: K, value: ServerSettings[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSuccess(false);
  };

  const parseList = (value: string) =>
    value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

  const handleTestImmich = async () => {
    setTestingImmich(true);
    setImmichTestResult(null);
    try {
      const result = await api.testImmichConnection(form.immichServerUrl, form.immichApiKey);
      setImmichTestResult(result.ok ? 'ok' : result.error);
    } catch {
      setImmichTestResult('unreachable');
    } finally {
      setTestingImmich(false);
    }
  };

  const handleTestLocalMedia = async () => {
    setTestingLocalMedia(true);
    setLocalMediaTestResult(null);
    try {
      const result = await api.testLocalMediaPath(form.localMediaPath);
      setLocalMediaTestResult(result.ok ? 'ok' : result.error);
    } catch {
      setLocalMediaTestResult('not_found');
    } finally {
      setTestingLocalMedia(false);
    }
  };

  const handleDiscard = () => {
    if (settings) setForm(settings);
    setError(null);
    setSuccess(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      const updated = await api.updateSettings(form);
      setSettings(updated);
      setForm(updated);
      setSuccess(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="loading">{t('common.loading')}</div>;
  if (error && !settings) return <div className="error">{error}</div>;

  const oidcConfigured = Boolean(form.oidcIssuer && form.oidcClientId);
  const immichConfigured = Boolean(form.immichServerUrl && form.immichApiKey);
  const localConfigured = Boolean(form.localMediaPath);
  const anyChannelEnabled = form.pushNotificationsEnabled || form.emailNotificationsEnabled;
  const languageName = form.defaultLanguage === 'en' ? 'English' : 'Nederlands';

  const configuredBadge = (ok: boolean) => (
    <span className={`badge ${ok ? 'ok' : 'off'}`}>
      {ok ? t('serverSettings.statusConfigured') : t('serverSettings.statusNotConfigured')}
    </span>
  );
  const enabledBadge = (ok: boolean) => (
    <span className={`badge ${ok ? 'ok' : 'off'}`}>
      {ok ? t('serverSettings.statusEnabled') : t('serverSettings.statusDisabled')}
    </span>
  );

  const sections: {
    id: SectionId;
    icon: IconName;
    label: string;
    status: { ok?: boolean; label: string };
  }[] = [
    {
      id: 'general',
      icon: 'globe',
      label: t('serverSettings.general'),
      status: { label: languageName },
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
  ];

  return (
    <>
      <div className="page-header">
        <h2>{t('serverSettings.title')}</h2>
      </div>

      <div className="settings-layout">
        <nav className="card settings-nav" aria-label={t('serverSettings.title')}>
          {sections.map((section) => (
            <button
              key={section.id}
              type="button"
              className={`settings-nav-item${activeSection === section.id ? ' active' : ''}`}
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
            </button>
          ))}
        </nav>

        <div className="settings-content">
          <form onSubmit={handleSubmit} className="settings-form">
            {activeSection === 'general' && (
              <SettingsCard icon="globe" title={t('serverSettings.general')} desc={t('serverSettings.generalDesc')}>
                <label>
                  {t('serverSettings.defaultLanguage')}
                  <select
                    value={form.defaultLanguage}
                    onChange={(e) => updateField('defaultLanguage', e.target.value)}
                  >
                    {SUPPORTED_LANGUAGES.map((lang) => (
                      <option key={lang} value={lang}>
                        {lang === 'en' ? 'English' : 'Nederlands'}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="hint">{t('serverSettings.defaultLanguageHint')}</p>
                <div className="row">
                  <label style={{ flex: 1 }}>
                    {t('serverSettings.appStoreUrl')}
                    <input
                      type="url"
                      value={form.appStoreUrl}
                      onChange={(e) => updateField('appStoreUrl', e.target.value)}
                      placeholder="https://apps.apple.com/app/..."
                    />
                  </label>
                  <label style={{ flex: 1 }}>
                    {t('serverSettings.playStoreUrl')}
                    <input
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
                    <input
                      type="text"
                      value={form.oidcName}
                      onChange={(e) => updateField('oidcName', e.target.value)}
                      placeholder="Authentik"
                    />
                  </label>
                  <label>
                    {t('serverSettings.oidcIssuer')}
                    <input
                      type="text"
                      value={form.oidcIssuer}
                      onChange={(e) => updateField('oidcIssuer', e.target.value)}
                      placeholder="https://auth.example.com/application/o/famlin/"
                    />
                  </label>
                  <label>
                    {t('serverSettings.oidcClientId')}
                    <input
                      type="text"
                      value={form.oidcClientId}
                      onChange={(e) => updateField('oidcClientId', e.target.value)}
                    />
                  </label>
                  <label>
                    {t('serverSettings.oidcClientSecret')}
                    <input
                      type="password"
                      value={form.oidcClientSecret}
                      onChange={(e) => updateField('oidcClientSecret', e.target.value)}
                    />
                  </label>
                  <p className="hint">{t('serverSettings.oidcClientSecretHint')}</p>
                  <label>
                    {t('serverSettings.oidcScopes')}
                    <input
                      type="text"
                      value={form.oidcScopes}
                      onChange={(e) => updateField('oidcScopes', e.target.value)}
                      placeholder="openid email profile"
                    />
                  </label>
                </SettingsCard>

                <SettingsCard icon="shield" title={t('serverSettings.accessControl')}>
                  <label>
                    {t('serverSettings.allowedEmails')}
                    <input
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
                      <input
                        type="text"
                        value={form.smtpHost}
                        onChange={(e) => updateField('smtpHost', e.target.value)}
                        placeholder="smtp.example.com"
                      />
                    </label>
                    <label style={{ flex: 1 }}>
                      {t('serverSettings.port')}
                      <input
                        type="number"
                        value={form.smtpPort}
                        onChange={(e) => updateField('smtpPort', parseInt(e.target.value, 10) || 0)}
                      />
                    </label>
                  </div>
                  <div className="row">
                    <label style={{ flex: 1 }}>
                      {t('serverSettings.smtpUsername')}
                      <input
                        type="text"
                        value={form.smtpUser}
                        onChange={(e) => updateField('smtpUser', e.target.value)}
                      />
                    </label>
                    <label style={{ flex: 1 }}>
                      {t('serverSettings.smtpPassword')}
                      <input
                        type="password"
                        value={form.smtpPass}
                        onChange={(e) => updateField('smtpPass', e.target.value)}
                      />
                    </label>
                  </div>
                  <label>
                    {t('serverSettings.senderAddress')}
                    <input
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
                    <input
                      type="url"
                      value={form.immichServerUrl}
                      onChange={(e) => {
                        updateField('immichServerUrl', e.target.value);
                        setImmichTestResult(null);
                      }}
                      placeholder="https://immich.example.com"
                    />
                  </label>
                  <label>
                    {t('serverSettings.immichApiKey')}
                    <input
                      type="password"
                      value={form.immichApiKey}
                      onChange={(e) => {
                        updateField('immichApiKey', e.target.value);
                        setImmichTestResult(null);
                      }}
                    />
                  </label>
                  <div className="settings-test-row">
                    <button
                      type="button"
                      className="secondary"
                      onClick={handleTestImmich}
                      disabled={testingImmich || !form.immichServerUrl || !form.immichApiKey}
                    >
                      {testingImmich ? t('serverSettings.immichTesting') : t('serverSettings.immichTestConnection')}
                    </button>
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
                </SettingsCard>

                <SettingsCard
                  icon="folder"
                  title={t('serverSettings.localMedia')}
                  desc={t('serverSettings.localMediaHint')}
                  badge={configuredBadge(localConfigured)}
                >
                  <label>
                    {t('serverSettings.localMediaPath')}
                    <input
                      type="text"
                      value={form.localMediaPath}
                      onChange={(e) => {
                        updateField('localMediaPath', e.target.value);
                        setLocalMediaTestResult(null);
                      }}
                      placeholder="/media/family-photos"
                    />
                  </label>
                  <div className="settings-test-row">
                    <button
                      type="button"
                      className="secondary"
                      onClick={handleTestLocalMedia}
                      disabled={testingLocalMedia || !form.localMediaPath}
                    >
                      {testingLocalMedia ? t('serverSettings.localMediaTesting') : t('serverSettings.localMediaTest')}
                    </button>
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

            {(dirty || success || error) && (
              <div className="save-bar">
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
                <div className="save-bar-actions">
                  {dirty && (
                    <button type="button" className="secondary" onClick={handleDiscard} disabled={saving}>
                      {t('serverSettings.discard')}
                    </button>
                  )}
                  <button type="submit" disabled={saving || !dirty}>
                    {saving ? t('serverSettings.saving') : t('serverSettings.saveSettings')}
                  </button>
                </div>
              </div>
            )}
          </form>

          {activeSection === 'media' && (
            <div className="card">
              <PeopleMappingSection users={users} />
            </div>
          )}
        </div>
      </div>
    </>
  );
}
