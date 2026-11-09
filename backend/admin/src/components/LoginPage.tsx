import { AppIcon } from './Logo'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { startBrowserOidcLogin, completeBrowserOidcLogin, clearBrowserOidcLogin } from '@famlin/api-client'
import { LanguageSelector } from './LanguageSelector'
import { api, OidcConfig, User } from '../api/client'
import { AuthShell } from '@famlin/ui/common/auth-shell'
import { FormField } from '@famlin/ui/common/form-field'
import { Button } from '@famlin/ui/button'
import { Input } from '@famlin/ui/input'
import { Alert, AlertDescription } from '@famlin/ui/alert'
import { Separator } from '@famlin/ui/separator'

// Must stay exactly this URL — deployments have it registered as the
// redirect_uri with their OIDC provider.
function getOidcRedirectUri(): string {
  return new URL('/admin/', window.location.origin).toString()
}

export function LoginPage({ onLogin, notice }: { onLogin: (user: User) => void; notice?: string }) {
  const { t } = useTranslation()
  const [error, setError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSsoLoading, setIsSsoLoading] = useState(false)
  const [oidcConfig, setOidcConfig] = useState<OidcConfig | null>(null)

  const finishLogin = (result: { token: string; user: User }) => {
    if (!result.user.isAdmin) {
      localStorage.removeItem('famlin_admin_token')
      setError(t('app.noAccessMessage'))
      return
    }
    localStorage.setItem('famlin_admin_token', result.token)
    onLogin(result.user)
  }

  useEffect(() => {
    api
      .getOidcConfig()
      .then(setOidcConfig)
      .catch(() => setOidcConfig(null))
  }, [])

  // Finish an SSO round-trip: the provider redirected back to us with
  // ?code=&state= — exchange it for a session (shared with web's LoginPage,
  // see packages/api-client/src/oidcBrowser.ts).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const state = params.get('state')
    const providerError = params.get('error')

    if (providerError) {
      // The provider redirected back without a code (user denied consent, or
      // the authorization failed upstream) — abort the stored round trip and
      // tell the user, instead of silently landing back on the form.
      clearBrowserOidcLogin()
      window.history.replaceState({}, '', window.location.pathname)
      setError(t('login.ssoLoginFailed'))
      return
    }
    if (!code) return

    const finishSsoLogin = async () => {
      setIsSsoLoading(true)
      try {
        const result = await completeBrowserOidcLogin(code, state, getOidcRedirectUri())
        finishLogin({ token: result.token, user: result.user as User })
      } catch (err: any) {
        // err.message is an untranslated slug from the shared helper — show
        // the backend's translated error when there is one, else the generic.
        setError(err.response?.data?.error || t('login.ssoLoginFailed'))
      } finally {
        window.history.replaceState({}, '', window.location.pathname)
        setIsSsoLoading(false)
      }
    }

    finishSsoLogin()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSsoLogin = async () => {
    if (!oidcConfig?.enabled) return
    setIsSsoLoading(true)
    setError(null)
    try {
      const url = await startBrowserOidcLogin(oidcConfig, getOidcRedirectUri())
      window.location.assign(url)
    } catch {
      setError(t('login.ssoLoginFailed'))
      setIsSsoLoading(false)
    }
  }

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsLoading(true)
    try {
      const result = await api.loginWithPassword(email, password)
      finishLogin(result)
    } catch (err: any) {
      setError(err.message || t('login.loginFailed'))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <AuthShell logo={<AppIcon size={80} />}>
      <div>
        <h1 className="text-3xl font-black tracking-tight text-primary">{t('login.title')}</h1>
        <p className="mt-2 font-semibold text-muted-foreground">
          {oidcConfig?.enabled ? t('login.subtitleWithSso', { name: oidcConfig.name }) : t('login.subtitleWithoutSso')}
        </p>
      </div>
      {notice && (
        <p className="font-semibold text-muted-foreground" role="status">
          {notice}
        </p>
      )}
      <form className="flex flex-col gap-4 text-left" onSubmit={handlePasswordLogin}>
        <FormField label={t('common.email')} htmlFor="login-email">
          <Input
            id="login-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
        </FormField>
        <FormField label={t('common.password')} htmlFor="login-password">
          <Input
            id="login-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </FormField>
        <Button type="submit" size="lg" disabled={isLoading}>
          {isLoading ? t('common.loading') : t('login.loginButton')}
        </Button>
      </form>
      {oidcConfig?.enabled && (
        <>
          <div className="relative py-2">
            <Separator />
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-3 text-sm text-muted-foreground">
              {t('common.or', { defaultValue: 'or' })}
            </span>
          </div>
          <Button type="button" size="lg" onClick={handleSsoLogin} disabled={isSsoLoading}>
            {isSsoLoading ? t('common.loading') : t('login.loginWithSso', { name: oidcConfig.name })}
          </Button>
        </>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <LanguageSelector className="justify-center" />
    </AuthShell>
  )
}
