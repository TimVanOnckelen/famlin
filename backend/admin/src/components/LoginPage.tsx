import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppIcon } from './Logo';
import { api, OidcConfig, User } from '../api/client';
import { generateCodeChallenge, generateRandomString, getOidcRedirectUri } from '../oidcPkce';

interface LoginPageProps {
  onLogin: (user: User) => void;
}

const VERIFIER_KEY = 'famlin_oidc_verifier';
const STATE_KEY = 'famlin_oidc_state';
const CONFIG_KEY = 'famlin_oidc_config';

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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    if (!code) return;

    const finishSsoLogin = async () => {
      setIsSsoLoading(true);
      try {
        const storedState = sessionStorage.getItem(STATE_KEY);
        const verifier = sessionStorage.getItem(VERIFIER_KEY);
        const configJson = sessionStorage.getItem(CONFIG_KEY);
        if (!storedState || !verifier || !configJson || state !== storedState) {
          throw new Error(t('login.ssoLoginFailed'));
        }
        const config = JSON.parse(configJson) as OidcConfig;

        let result: { token: string; user: User };
        if (config.usesClientSecret) {
          // Providers that require a client secret (e.g. Google) reject a
          // secretless PKCE exchange from the browser — hand the code to the
          // backend instead, which holds the secret and does the exchange.
          result = await api.exchangeOidcCode(code, getOidcRedirectUri(), verifier);
        } else {
          const tokenRes = await fetch(config.tokenEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              grant_type: 'authorization_code',
              code,
              redirect_uri: getOidcRedirectUri(),
              client_id: config.clientId,
              code_verifier: verifier,
            }),
          });
          if (!tokenRes.ok) {
            throw new Error(t('login.ssoLoginFailed'));
          }
          const tokenData = await tokenRes.json();
          if (!tokenData.id_token) {
            throw new Error(t('login.ssoLoginFailed'));
          }
          result = await api.loginWithOidc(tokenData.id_token);
        }

        localStorage.setItem('famlin_admin_token', result.token);
        onLogin(result.user);
      } catch (err: any) {
        setError(err.message || t('login.ssoLoginFailed'));
      } finally {
        sessionStorage.removeItem(VERIFIER_KEY);
        sessionStorage.removeItem(STATE_KEY);
        sessionStorage.removeItem(CONFIG_KEY);
        window.history.replaceState({}, '', window.location.pathname);
        setIsSsoLoading(false);
      }
    };

    finishSsoLogin();
  }, []);

  const handleSsoLogin = async () => {
    if (!oidcConfig?.enabled) return;

    setIsSsoLoading(true);
    setError(null);
    try {
      const verifier = generateRandomString();
      const challenge = await generateCodeChallenge(verifier);
      const state = generateRandomString(32);

      sessionStorage.setItem(VERIFIER_KEY, verifier);
      sessionStorage.setItem(STATE_KEY, state);
      sessionStorage.setItem(CONFIG_KEY, JSON.stringify(oidcConfig));

      const url = new URL(oidcConfig.authorizationEndpoint);
      url.search = new URLSearchParams({
        response_type: 'code',
        client_id: oidcConfig.clientId,
        redirect_uri: getOidcRedirectUri(),
        scope: oidcConfig.scopes,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
      }).toString();

      window.location.assign(url.toString());
    } catch (err: any) {
      setError(err.message || t('login.ssoLoginFailed'));
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
