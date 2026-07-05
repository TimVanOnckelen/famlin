import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ServerSettings } from '../api/client';
import { SUPPORTED_LANGUAGES } from '../i18n';

export function ServerSettingsPage() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<ServerSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

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
  });

  const [testingImmich, setTestingImmich] = useState(false);
  const [immichTestResult, setImmichTestResult] = useState<'ok' | 'unreachable' | 'unauthorized' | null>(null);

  useEffect(() => {
    api
      .getSettings()
      .then((s) => {
        setSettings(s);
        setForm(s);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const updateField = <K extends keyof ServerSettings>(key: K, value: ServerSettings[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
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

  return (
    <>
      <div className="page-header">
        <h2>{t('serverSettings.title')}</h2>
      </div>

      <form onSubmit={handleSubmit} className="card">
        <h3>{t('serverSettings.general')}</h3>
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
        <label>
          {t('serverSettings.appStoreUrl')}
          <input
            type="url"
            value={form.appStoreUrl}
            onChange={(e) => updateField('appStoreUrl', e.target.value)}
            placeholder="https://apps.apple.com/app/..."
          />
        </label>
        <label>
          {t('serverSettings.playStoreUrl')}
          <input
            type="url"
            value={form.playStoreUrl}
            onChange={(e) => updateField('playStoreUrl', e.target.value)}
            placeholder="https://play.google.com/store/apps/details?id=..."
          />
        </label>
        <p className="hint">{t('serverSettings.storeUrlsHint')}</p>

        <h3 style={{ marginTop: '1.5rem' }}>{t('serverSettings.oidc')}</h3>
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
        <p className="hint">{t('serverSettings.oidcHint')}</p>

        <h3 style={{ marginTop: '1.5rem' }}>{t('serverSettings.accessControl')}</h3>
        <label>
          {t('serverSettings.allowedEmails')}
          <input
            type="text"
            value={form.allowedEmails.join(', ')}
            onChange={(e) => updateField('allowedEmails', parseList(e.target.value))}
            placeholder="family@example.com"
          />
        </label>

        <h3 style={{ marginTop: '1.5rem' }}>{t('serverSettings.push')}</h3>
        <label style={{ flexDirection: 'row', alignItems: 'center', gap: '0.5rem' }}>
          <input
            type="checkbox"
            checked={form.pushNotificationsEnabled}
            onChange={(e) => updateField('pushNotificationsEnabled', e.target.checked)}
          />
          {t('serverSettings.pushEnabled')}
        </label>
        <p className="hint">{t('serverSettings.pushHint')}</p>

        <h3 style={{ marginTop: '1.5rem' }}>{t('serverSettings.emailSmtp')}</h3>
        <label style={{ flexDirection: 'row', alignItems: 'center', gap: '0.5rem' }}>
          <input
            type="checkbox"
            checked={form.emailNotificationsEnabled}
            onChange={(e) => updateField('emailNotificationsEnabled', e.target.checked)}
          />
          {t('serverSettings.emailEnabled')}
        </label>
        <p className="hint">{t('serverSettings.emailHint')}</p>
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
        <label>
          {t('serverSettings.smtpUsername')}
          <input
            type="text"
            value={form.smtpUser}
            onChange={(e) => updateField('smtpUser', e.target.value)}
          />
        </label>
        <label>
          {t('serverSettings.smtpPassword')}
          <input
            type="password"
            value={form.smtpPass}
            onChange={(e) => updateField('smtpPass', e.target.value)}
          />
        </label>
        <label>
          {t('serverSettings.senderAddress')}
          <input
            type="email"
            value={form.smtpFrom}
            onChange={(e) => updateField('smtpFrom', e.target.value)}
            placeholder="Famlin <noreply@example.com>"
          />
        </label>

        <h3 style={{ marginTop: '1.5rem' }}>{t('serverSettings.immich')}</h3>
        <p className="hint">{t('serverSettings.immichHint')}</p>
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
        <div className="row" style={{ alignItems: 'center', gap: '0.75rem' }}>
          <button
            type="button"
            className="secondary"
            onClick={handleTestImmich}
            disabled={testingImmich || !form.immichServerUrl || !form.immichApiKey}
          >
            {testingImmich ? t('serverSettings.immichTesting') : t('serverSettings.immichTestConnection')}
          </button>
          {immichTestResult === 'ok' && <span className="success">{t('serverSettings.immichTestOk')}</span>}
          {immichTestResult === 'unauthorized' && (
            <span className="error">{t('serverSettings.immichTestUnauthorized')}</span>
          )}
          {immichTestResult === 'unreachable' && (
            <span className="error">{t('serverSettings.immichTestUnreachable')}</span>
          )}
        </div>

        <div style={{ marginTop: '1rem' }}>
          <button type="submit" disabled={saving}>
            {saving ? t('serverSettings.saving') : t('serverSettings.saveSettings')}
          </button>
        </div>

        {success && <div className="success">{t('serverSettings.saved')}</div>}
        {error && <div className="error">{error}</div>}
      </form>
    </>
  );
}
