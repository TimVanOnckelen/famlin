import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppIcon } from './Logo';
import { api, User } from '../api/client';

interface SetupPageProps {
  onSetupComplete: (user: User) => void;
}

export function SetupPage({ onSetupComplete }: SetupPageProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  // 'restore' swaps account creation for restoring a data export
  // (POST /api/auth/setup/restore) — the same account fields double as the
  // restoring admin's login.
  const [mode, setMode] = useState<'create' | 'restore'>('create');
  const [archive, setArchive] = useState<File | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError(t('setup.passwordMismatch'));
      return;
    }

    if (mode === 'restore' && !archive) {
      setError(t('setup.restoreFailed'));
      return;
    }

    setIsLoading(true);
    try {
      const result =
        mode === 'restore' && archive
          ? await api.restoreBackup(archive, { email, name, password })
          : await api.setup({ email, name, password });
      localStorage.setItem('famlin_admin_token', result.token);
      onSetupComplete(result.user);
    } catch (err: any) {
      setError(err.message || t(mode === 'restore' ? 'setup.restoreFailed' : 'setup.setupFailed'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="card login-box">
        <div className="login-logo">
          <AppIcon size={80} />
        </div>
        <h1>{t('setup.title')}</h1>
        <p>{t(mode === 'restore' ? 'setup.restoreSubtitle' : 'setup.subtitle')}</p>

        <form onSubmit={handleSubmit}>
          {mode === 'restore' && (
            <>
              <label>
                {t('setup.restoreArchiveLabel')}
                <input
                  type="file"
                  accept=".zip,application/zip"
                  onChange={(e) => setArchive(e.target.files?.[0] ?? null)}
                  required
                />
              </label>
              <p className="hint">{t('setup.restoreAccountHint')}</p>
            </>
          )}
          <label>
            {t('common.name')}
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </label>
          <label>
            {t('common.email')}
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label>
            {t('common.password')}
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
            />
          </label>
          <label>
            {t('setup.confirmPasswordLabel')}
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              minLength={8}
              required
            />
          </label>
          {mode === 'restore' && <p className="hint">{t('setup.restoreAfterHint')}</p>}
          <button type="submit" disabled={isLoading}>
            {isLoading
              ? t(mode === 'restore' ? 'setup.restoring' : 'common.loading')
              : t(mode === 'restore' ? 'setup.restoreButton' : 'setup.createAccountButton')}
          </button>
        </form>

        <button
          type="button"
          className="link-button"
          disabled={isLoading}
          onClick={() => {
            setMode(mode === 'restore' ? 'create' : 'restore');
            setError(null);
          }}
        >
          {t(mode === 'restore' ? 'setup.modeCreate' : 'setup.modeRestore')}
        </button>

        {error && <div className="error">{error}</div>}
      </div>
    </div>
  );
}
