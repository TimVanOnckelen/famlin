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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError(t('setup.passwordMismatch'));
      return;
    }

    setIsLoading(true);
    try {
      const result = await api.setup({ email, name, password });
      localStorage.setItem('famlin_admin_token', result.token);
      onSetupComplete(result.user);
    } catch (err: any) {
      setError(err.message || t('setup.setupFailed'));
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
        <p>{t('setup.subtitle')}</p>

        <form onSubmit={handleSubmit}>
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
          <button type="submit" disabled={isLoading}>
            {isLoading ? t('common.loading') : t('setup.createAccountButton')}
          </button>
        </form>

        {error && <div className="error">{error}</div>}
      </div>
    </div>
  );
}
