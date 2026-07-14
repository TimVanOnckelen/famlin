import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { startBrowserOidcLogin, completeBrowserOidcLogin, clearBrowserOidcLogin } from '@famlin/api-client';
import { AppIcon } from './Logo';
import { api, OidcConfig, User } from '../api/client';

interface LoginPageProps {
  onLogin: (user: User) => void;
}

// Must stay exactly this URL — deployments have it registered as the
// redirect_uri with their OIDC provider.
function getOidcRedirectUri(): string {
  return new URL('/admin/', window.location.origin).toString();
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSsoLoading, setIsSsoLoading] = useState(false);
  const [oidcConfig, setOidcConfig] = useState<OidcConfig | null>(null);

  useEffect(() => {
    api
      .getOidcConfig()
      .then(setOidcConfig)
      .catch(() => setOidcConfig(null));
  }, []);

  // Finish an SSO round-trip: the provider redirected back to us with
  // ?code=&state= — exchange it for a session (shared with web's LoginPage,
  // see packages/api-client/src/oidcBrowser.ts).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    const providerError = params.get('error');

    // The provider redirected back without a code (user denied consent, or
    // the authorization failed upstream) — abort the stored round trip and
    // tell the user, instead of silently landing back on the form.
    if (providerError) {
      clearBrowserOidcLogin();
      window.history.replaceState({}, '', window.location.pathname);
      setError(t('login.ssoLoginFailed'));
      return;
    }
    if (!code) return;

    const finishSsoLogin = async () => {
      setIsSsoLoading(true);
      try {
        const result = await completeBrowserOidcLogin(code, state, getOidcRedirectUri());
        localStorage.setItem('famlin_admin_token', result.token);
        onLogin(result.user as User);
      } catch (err: any) {
        // err.message is an untranslated slug from the shared helper — show
        // the backend's translated error when there is one, else the generic.
        setError(err.response?.data?.error || t('login.ssoLoginFailed'));
      } finally {
        window.history.replaceState({}, '', window.location.pathname);
        setIsSsoLoading(false);
      }
    };

    finishSsoLogin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSsoLogin = async () => {
    if (!oidcConfig?.enabled) return;

    setIsSsoLoading(true);
    setError(null);
    try {
      const url = await startBrowserOidcLogin(oidcConfig, getOidcRedirectUri());
      window.location.assign(url);
    } catch {
      setError(t('login.ssoLoginFailed'));
      setIsSsoLoading(false);
    }
  };

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const result = await api.loginWithPassword(email, password);
      localStorage.setItem('famlin_admin_token', result.token);
      onLogin(result.user);
    } catch (err: any) {
      setError(err.message || t('login.loginFailed'));
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
        <h1>{t('login.title')}</h1>
        <p>
          {oidcConfig?.enabled
            ? t('login.subtitleWithSso', { name: oidcConfig.name })
            : t('login.subtitleWithoutSso')}
        </p>

        <form onSubmit={handlePasswordLogin}>
          <label>
            {t('common.email')}
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </label>
          <label>
            {t('common.password')}
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          <button type="submit" disabled={isLoading}>
            {isLoading ? t('common.loading') : t('login.loginButton')}
          </button>
        </form>

        {oidcConfig?.enabled && (
          <>
            <div className="divider">
              <span>{t('common.or', { defaultValue: 'or' })}</span>
            </div>

            <button type="button" onClick={handleSsoLogin} disabled={isSsoLoading}>
              {isSsoLoading ? t('common.loading') : t('login.loginWithSso', { name: oidcConfig.name })}
            </button>
          </>
        )}
        {error && <div className="error">{error}</div>}
      </div>
    </div>
  );
}
