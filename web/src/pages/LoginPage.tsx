import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  fetchOidcConfig,
  loginWithPassword,
  OidcConfig,
  startBrowserOidcLogin,
  completeBrowserOidcLogin,
  clearBrowserOidcLogin,
} from '@famlin/api-client';
import { AppIcon } from '@/components/Logo';
import { useAuthStore } from '@/stores/authStore';
import './LoginPage.css';

function getOidcRedirectUri(): string {
  return new URL('/', window.location.origin).toString();
}

// The login/splash "photo-collage arrival" pattern from the styleguide:
// three tilted polaroid frames (−8° / −2° / +7°) over a soft primary-tint
// glow, setting the photo-forward tone before any real photos are loaded.
function PhotoCollage() {
  return (
    <div className="login-collage" aria-hidden="true">
      <div className="login-collage-glow" />
      <div className="login-polaroid login-polaroid-left">
        <div className="login-polaroid-photo" />
      </div>
      <div className="login-polaroid login-polaroid-center">
        <div className="login-polaroid-photo" />
      </div>
      <div className="login-polaroid login-polaroid-right">
        <div className="login-polaroid-photo" />
      </div>
    </div>
  );
}

export function LoginPage() {
  const { t } = useTranslation();
  const { setAuth } = useAuthStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSsoLoading, setIsSsoLoading] = useState(false);
  const [oidcConfig, setOidcConfig] = useState<OidcConfig | null>(null);

  useEffect(() => {
    fetchOidcConfig()
      .then(setOidcConfig)
      .catch(() => setOidcConfig(null));
  }, []);

  // Finish an SSO round-trip: the provider redirected back to us with
  // ?code=&state= — exchange it for a session (same flow as the admin UI).
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

    async function finishSsoLogin() {
      setIsSsoLoading(true);
      try {
        const result = await completeBrowserOidcLogin(code!, state, getOidcRedirectUri());
        await setAuth(result.user, result.token);
      } catch (err: any) {
        // err.message is an untranslated slug from the shared helper — show
        // the backend's translated error when there is one, else the generic.
        setError(err.response?.data?.error || t('login.ssoLoginFailed'));
      } finally {
        window.history.replaceState({}, '', window.location.pathname);
        setIsSsoLoading(false);
      }
    }

    finishSsoLogin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSsoLogin() {
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
  }

  async function handlePasswordLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      const result = await loginWithPassword(email.trim(), password);
      await setAuth(result.user, result.token);
    } catch (err: any) {
      setError(err.response?.data?.error || t('login.loginFailed'));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-panel">
        <PhotoCollage />

        <div className="login-brand">
          <AppIcon size={76} />
          <h1 className="login-wordmark">{t('common.appName')}</h1>
          <p className="login-subtitle">{t('login.subtitle')}</p>
        </div>

        <div className="login-card">
          <form onSubmit={handlePasswordLogin} className="login-form">
            <label className="field">
              <span className="field-label">{t('login.emailLabel')}</span>
              <input
                className="field-input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('login.emailPlaceholder')}
                autoComplete="email"
                required
                autoFocus
              />
            </label>

            <label className="field">
              <span className="field-label">{t('login.passwordLabel')}</span>
              <input
                className="field-input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('login.passwordPlaceholder')}
                autoComplete="current-password"
                required
              />
            </label>

            <button className="btn btn-primary login-submit" type="submit" disabled={isLoading}>
              {isLoading ? t('common.loading') : t('login.loginButton')}
            </button>
          </form>

          {oidcConfig?.enabled && (
            <>
              <div className="login-divider">
                <span>{t('common.or')}</span>
              </div>
              <button
                className="btn btn-secondary login-sso"
                type="button"
                onClick={handleSsoLogin}
                disabled={isSsoLoading}
              >
                {isSsoLoading ? t('common.loading') : t('login.loginWithSso', { name: oidcConfig.name })}
              </button>
            </>
          )}

          {error && (
            <div className="login-error" role="alert">
              {error}
            </div>
          )}
        </div>

        <p className="login-hint">{t('login.invitationOnly')}</p>
      </div>
    </div>
  );
}
