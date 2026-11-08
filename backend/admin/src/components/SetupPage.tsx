import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AppIcon } from './Logo'
import { LanguageSelector } from './LanguageSelector'
import { api, User, ApiError } from '../api/client'

// Where a scheduled backup's photos come from on a new server.
const DUMP_RESTORE_DOCS_URL = 'https://famlin.app/docs/maintenance#restoring-from-a-scheduled-backup'

interface SetupPageProps {
  onSetupComplete: (user: User, restored: boolean) => void
  onDumpRestored: () => void
}

export function SetupPage({ onSetupComplete, onDumpRestored }: SetupPageProps) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  // 'restore' swaps account creation for restoring a data export
  // (POST /api/auth/setup/restore) — the same account fields double as the
  // restoring admin's login.
  const [mode, setMode] = useState<'create' | 'restore'>('create')
  const [archive, setArchive] = useState<File | null>(null)
  const [missingMedia, setMissingMedia] = useState<string[]>([])
  // A scheduled backup (.dump) is the whole database, accounts included, so
  // it needs no account fields (POST /api/auth/setup/restore-dump).
  const isDump = mode === 'restore' && !!archive?.name.toLowerCase().endsWith('.dump')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setMissingMedia([])

    if (!isDump && password !== confirmPassword) {
      setError(t('setup.passwordMismatch'))
      return
    }

    if (mode === 'restore' && !archive) {
      setError(t('setup.restoreFailed'))
      return
    }

    setIsLoading(true)
    try {
      if (isDump && archive) {
        await api.restoreDump(archive)
        onDumpRestored()
        return
      }
      const result =
        mode === 'restore' && archive
          ? await api.restoreBackup(archive, { email, name, password })
          : await api.setup({ email, name, password })
      localStorage.setItem('famlin_admin_token', result.token)
      onSetupComplete(result.user, mode === 'restore')
    } catch (err) {
      setError(err instanceof Error ? err.message : t(mode === 'restore' ? 'setup.restoreFailed' : 'setup.setupFailed'))
      if (err instanceof ApiError) setMissingMedia(err.missingMedia ?? [])
    } finally {
      setIsLoading(false)
    }
  }

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
                  accept=".zip,.dump,application/zip"
                  onChange={(e) => setArchive(e.target.files?.[0] ?? null)}
                  required
                />
              </label>
              <p className="hint">{t('setup.restoreSourceHint')}</p>
              <p className="hint">
                {t(isDump ? 'setup.restoreDumpHint' : 'setup.restoreAccountHint')}
                {isDump && (
                  <>
                    {' '}
                    <a href={DUMP_RESTORE_DOCS_URL} target="_blank" rel="noreferrer">
                      {t('setup.restoreDumpDocsLink')}
                    </a>
                  </>
                )}
              </p>
            </>
          )}
          {!isDump && (
            <>
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
            </>
          )}
          {mode === 'restore' && !isDump && <p className="hint">{t('setup.restoreAfterHint')}</p>}
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
            setMode(mode === 'restore' ? 'create' : 'restore')
            setError(null)
            setMissingMedia([])
          }}
        >
          {t(mode === 'restore' ? 'setup.modeCreate' : 'setup.modeRestore')}
        </button>

        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        {missingMedia.length > 0 && (
          <div>
            <p>
              {t('storage.files')}: {missingMedia.length.toLocaleString()}
            </p>
            <ul>
              {missingMedia.slice(0, 100).map((key) => (
                <li key={key}>
                  <code>{key}</code>
                </li>
              ))}
            </ul>
          </div>
        )}

        <LanguageSelector className="login-language" />
      </div>
    </div>
  )
}
