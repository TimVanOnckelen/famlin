import { AppIcon } from './Logo'
import { StateMessage } from '@famlin/ui/common/state-message'
import { AuthShell } from '@famlin/ui/common/auth-shell'
import { Input } from '@famlin/ui/input'
import { Button } from '@famlin/ui/button'
import { SelectField } from '@famlin/ui/common/select-field'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LanguageSelector } from './LanguageSelector'
import { api, User, ApiError } from '../api/client'

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

  // Scheduled-backup dumps already in the server's backups volume. Only
  // those can be restored (POST /api/auth/setup/restore-dump) — the whole
  // database, accounts included, so they need no account fields.
  const [dumps, setDumps] = useState<{ name: string; createdAt: string }[]>([])
  const [dumpName, setDumpName] = useState('')

  useEffect(() => {
    if (mode !== 'restore') return
    api
      .listSetupDumps()
      .then((list) => {
        setDumps(list)
        setDumpName(list[0]?.name ?? '')
      })
      .catch(() => setDumps([]))
  }, [mode])

  const handleDumpRestore = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setMissingMedia([])
    setIsLoading(true)
    try {
      await api.restoreDump(dumpName)
      onDumpRestored()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('setup.restoreFailed'))
    } finally {
      setIsLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setMissingMedia([])

    if (password !== confirmPassword) {
      setError(t('setup.passwordMismatch'))
      return
    }

    if (mode === 'restore' && !archive) {
      setError(t('setup.restoreFailed'))
      return
    }

    setIsLoading(true)
    try {
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
    <AuthShell logo={<AppIcon size={80} />}>
      <h1>{t('setup.title')}</h1>
      <p>{t(mode === 'restore' ? 'setup.restoreSubtitle' : 'setup.subtitle')}</p>

      <form onSubmit={handleSubmit}>
        {mode === 'restore' && (
          <>
            <label>
              {t('setup.restoreArchiveLabel')}
              <Input
                type="file"
                accept=".zip,application/zip"
                onChange={(e) => setArchive(e.target.files?.[0] ?? null)}
                required
              />
            </label>
            <p className="hint">{t('setup.restoreSourceHint')}</p>
            <p className="hint">{t('setup.restoreAccountHint')}</p>
          </>
        )}
        <label>
          {t('common.name')}
          <Input type="text" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </label>
        <label>
          {t('common.email')}
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          {t('common.password')}
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
        </label>
        <label>
          {t('setup.confirmPasswordLabel')}
          <Input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            minLength={8}
            required
          />
        </label>
        {mode === 'restore' && <p className="hint">{t('setup.restoreAfterHint')}</p>}
        <Button type="submit" disabled={isLoading}>
          {isLoading
            ? t(mode === 'restore' ? 'setup.restoring' : 'common.loading')
            : t(mode === 'restore' ? 'setup.restoreButton' : 'setup.createAccountButton')}
        </Button>
      </form>

      {mode === 'restore' &&
        (dumps.length > 0 ? (
          <form onSubmit={handleDumpRestore}>
            <h2>{t('setup.restoreDumpTitle')}</h2>
            <p className="hint">
              {t('setup.restoreDumpHint')}{' '}
              <a href={DUMP_RESTORE_DOCS_URL} target="_blank" rel="noreferrer">
                {t('setup.restoreDumpDocsLink')}
              </a>
            </p>
            <SelectField
              disabled={isLoading}
              value={dumpName}
              onValueChange={setDumpName}
              required
              aria-label={t('setup.restoreDumpTitle')}
              items={dumps.map((dump) => ({ value: dump.name, label: new Date(dump.createdAt).toLocaleString() }))}
            />
            <Button type="submit" disabled={isLoading || !dumpName}>
              {isLoading ? t('setup.restoring') : t('setup.restoreDumpButton')}
            </Button>
          </form>
        ) : (
          <p className="hint">
            {t('setup.restoreDumpNone')}{' '}
            <a href={DUMP_RESTORE_DOCS_URL} target="_blank" rel="noreferrer">
              {t('setup.restoreDumpDocsLink')}
            </a>
          </p>
        ))}

      <Button
        variant="link"
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
      </Button>

      {error && (
        <StateMessage variant="error" className="error" role="alert">
          {error}
        </StateMessage>
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
    </AuthShell>
  )
}
