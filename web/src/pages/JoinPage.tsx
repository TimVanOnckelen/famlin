import { useState, type FormEvent } from 'react'
import axios from 'axios'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  fetchInvitePreview,
  registerViaInvite,
  acceptInvite,
  loginWithPassword,
  fetchOidcConfig,
  type LoginResponse,
  type OidcConfig,
  type User,
} from '@famlin/api-client'
import { BrandIcon } from '@/components/Logo'
import { useBranding } from '@/hooks/useBranding'
import './LoginPage.css'
import './JoinPage.css'

export function JoinPage({
  token,
  user,
  loginFailed = false,
  onAuthenticated,
  onJoined,
  onStartSso,
  onSignOut,
  onCancel,
}: {
  token: string
  user: User | null
  loginFailed?: boolean
  onAuthenticated: (result: LoginResponse) => Promise<void>
  onJoined: (groupId: string) => void
  onStartSso: (config: OidcConfig) => Promise<void>
  onSignOut: () => Promise<void>
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const branding = useBranding()
  const client = useQueryClient()
  const [mode, setMode] = useState<'register' | 'login'>('register')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(loginFailed ? t('login.ssoLoginFailed') : null)
  const preview = useQuery({
    queryKey: ['invite', token],
    queryFn: () => fetchInvitePreview(token),
    retry: false,
    refetchOnWindowFocus: false,
  })
  const invite = preview.data
  const oidc = useQuery({
    queryKey: ['oidc-config'],
    queryFn: fetchOidcConfig,
    enabled: !user && invite?.status === 'valid',
    retry: false,
  })
  const targetEmail = invite?.email ?? email.trim()
  const mismatch = !!(user && invite?.email && user.email.toLowerCase() !== invite.email.toLowerCase())

  async function perform(action: () => Promise<void>) {
    if (submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await action()
    } catch (error) {
      setError(
        axios.isAxiosError(error) && typeof error.response?.data?.error === 'string'
          ? error.response.data.error
          : t('join.actionFailed')
      )
    } finally {
      setSubmitting(false)
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault()
    void perform(async () => {
      const result =
        mode === 'register'
          ? await registerViaInvite(token, { name: name.trim(), email: targetEmail, password })
          : await loginWithPassword(targetEmail, password, token)
      await onAuthenticated(result)
    })
  }
  return (
    <div className="login-page">
      <div className="login-panel join-panel">
        <div className="login-brand">
          <BrandIcon size={64} />
          <p className="join-brand-name">{branding?.name ?? t('common.appName')}</p>
        </div>
        <section className="login-card join-card" aria-labelledby="join-title">
          <h1 id="join-title">{t('join.title')}</h1>
          {preview.isPending && <p role="status">{t('common.loading')}</p>}
          {preview.isError && (
            <div role="alert">
              <p>{t('join.loadFailed')}</p>
              <button className="btn btn-secondary" onClick={() => void preview.refetch()}>
                {t('common.retry')}
              </button>
            </div>
          )}
          {invite && invite.status !== 'valid' && <p role="alert">{t(`join.status.${invite.status}`)}</p>}
          {invite?.status === 'valid' && (
            <>
              <h2 className="join-family">{invite.groupName}</h2>
              {invite.inviterName && <p>{t('join.invitedBy', { name: invite.inviterName })}</p>}
              {invite.groupDescription && <p className="join-description">{invite.groupDescription}</p>}
              {user ? (
                <>
                  <p>{t('join.signedInAs', { email: user.email })}</p>
                  {mismatch && <p role="alert">{t('join.emailMismatch', { email: invite.email })}</p>}
                  <button
                    className="btn btn-primary login-submit"
                    disabled={submitting || mismatch}
                    onClick={() =>
                      void perform(async () => {
                        const result = await acceptInvite(token)
                        await client.invalidateQueries({ queryKey: ['groups'] })
                        onJoined(result.groupId)
                      })
                    }
                  >
                    {submitting ? t('common.loading') : t('join.joinButton', { family: invite.groupName })}
                  </button>
                  <button className="join-text-button" disabled={submitting} onClick={() => void perform(onSignOut)}>
                    {t('join.switchAccount')}
                  </button>
                </>
              ) : (
                <>
                  <div className="join-modes" role="group" aria-label={t('join.accountOptions')}>
                    {(['register', 'login'] as const).map((value) => (
                      <button
                        type="button"
                        key={value}
                        aria-pressed={mode === value}
                        disabled={submitting}
                        onClick={() => {
                          setMode(value)
                          setPassword('')
                          setError(null)
                        }}
                      >
                        {t(`join.${value}`)}
                      </button>
                    ))}
                  </div>
                  <form className="login-form" onSubmit={submit}>
                    {mode === 'register' && (
                      <label className="field">
                        <span className="field-label">{t('join.name')}</span>
                        <input
                          className="field-input"
                          autoComplete="name"
                          value={name}
                          onChange={(event) => setName(event.target.value)}
                          required
                          maxLength={100}
                          disabled={submitting}
                        />
                      </label>
                    )}
                    <label className="field">
                      <span className="field-label">{t('login.emailLabel')}</span>
                      <input
                        className="field-input"
                        type="email"
                        autoComplete="email"
                        value={invite.email ?? email}
                        onChange={(event) => setEmail(event.target.value)}
                        required
                        readOnly={!!invite.email}
                        disabled={submitting}
                      />
                    </label>
                    <label className="field">
                      <span className="field-label">{t('login.passwordLabel')}</span>
                      <input
                        className="field-input"
                        type="password"
                        autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                        aria-describedby={mode === 'register' ? 'join-password-hint' : undefined}
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        required
                        minLength={mode === 'register' ? 8 : undefined}
                        maxLength={100}
                        disabled={submitting}
                      />
                    </label>
                    {mode === 'register' && (
                      <p id="join-password-hint" className="join-password-hint">
                        {t('join.passwordHint')}
                      </p>
                    )}
                    <button
                      className="btn btn-primary login-submit"
                      type="submit"
                      disabled={
                        submitting ||
                        !targetEmail ||
                        !password ||
                        (mode === 'register' && (!name.trim() || password.length < 8))
                      }
                    >
                      {submitting
                        ? t('common.loading')
                        : t(mode === 'register' ? 'join.createAndJoin' : 'join.loginAndJoin')}
                    </button>
                  </form>
                  {oidc.data?.enabled && (
                    <>
                      <div className="login-divider">
                        <span>{t('common.or')}</span>
                      </div>
                      <button
                        className="btn btn-secondary login-sso"
                        disabled={submitting}
                        onClick={() => void perform(() => onStartSso(oidc.data!))}
                      >
                        {t('login.loginWithSso', { name: oidc.data.name })}
                      </button>
                    </>
                  )}
                </>
              )}
            </>
          )}
          {error && (
            <p className="login-error" role="alert">
              {error}
            </p>
          )}
          <button className="join-text-button" disabled={submitting} onClick={onCancel}>
            {t('join.continueToApp')}
          </button>
        </section>
      </div>
    </div>
  )
}
