import { AppIcon } from './Logo'
import { StateMessage } from '@famlin/ui/common/state-message'
import { AuthShell } from '@famlin/ui/common/auth-shell'
import { Input } from '@famlin/ui/input'
import { Button } from '@famlin/ui/button'
import { Badge } from '@famlin/ui/badge'
import { Separator } from '@famlin/ui/separator'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LanguageSelector } from './LanguageSelector'
import { formatBytes } from './SystemStatusPage'
import { api, User, ApiError, type RestoreResult, type SetupAdmin, type VolumeBackup } from '../api/client'

const RESTORE_DOCS_URL = 'https://famlin.app/docs/maintenance#restoring-a-backup'

interface SetupPageProps {
  onSetupComplete: (user: User, restored: boolean) => void
  // A restore that brought back everyone's accounts: sign in with one of them.
  onRestoredWithAccounts: () => void
}

// What to restore: a backup found in the server's backups volume, or an
// uploaded zip. Kept while the account fields are asked for, so the restore
// is retried with them.
type RestoreSource = { kind: 'volume'; file: string } | { kind: 'upload'; file: File }

export function SetupPage({ onSetupComplete, onRestoredWithAccounts }: SetupPageProps) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  // 'restore' swaps account creation for restoring a backup. Famlin backups
  // bring back every account with its password, so the account fields only
  // appear for an older export without them (`needsAccount`).
  const [mode, setMode] = useState<'create' | 'restore'>('create')
  const [backups, setBackups] = useState<VolumeBackup[] | null>(null)
  const [selected, setSelected] = useState('')
  const [upload, setUpload] = useState<File | null>(null)
  const [needsAccount, setNeedsAccount] = useState<RestoreSource | null>(null)
  const [missingMedia, setMissingMedia] = useState<string[]>([])

  useEffect(() => {
    if (mode !== 'restore') return
    api
      .listSetupBackups()
      .then((list) => {
        setBackups(list)
        setSelected(list.find((b) => b.valid)?.name ?? '')
      })
      .catch(() => setBackups([]))
  }, [mode])

  const finish = (result: RestoreResult) => {
    if (result.token && result.user) {
      localStorage.setItem('famlin_admin_token', result.token)
      onSetupComplete(result.user, true)
    } else {
      onRestoredWithAccounts()
    }
  }

  const runRestore = async (source: RestoreSource, admin?: SetupAdmin) => {
    setError(null)
    setMissingMedia([])
    setIsLoading(true)
    try {
      finish(
        source.kind === 'volume'
          ? await api.restoreVolumeBackup(source.file, admin)
          : await api.restoreBackup(source.file, admin)
      )
    } catch (err) {
      if (err instanceof ApiError && err.code === 'restoreAdminRequired' && !admin) {
        setNeedsAccount(source)
      } else {
        setError(err instanceof Error ? err.message : t('setup.restoreFailed'))
        if (err instanceof ApiError) setMissingMedia(err.missingMedia ?? [])
      }
    } finally {
      setIsLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (password !== confirmPassword) {
      setError(t('setup.passwordMismatch'))
      return
    }
    if (needsAccount) {
      await runRestore(needsAccount, { email, name, password })
      return
    }
    setIsLoading(true)
    try {
      const result = await api.setup({ email, name, password })
      localStorage.setItem('famlin_admin_token', result.token)
      onSetupComplete(result.user, false)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('setup.setupFailed'))
    } finally {
      setIsLoading(false)
    }
  }

  const switchMode = () => {
    setMode(mode === 'restore' ? 'create' : 'restore')
    setNeedsAccount(null)
    setError(null)
    setMissingMedia([])
  }

  const mediaLabel = (backup: VolumeBackup) => {
    if (backup.type === 'dump') return t('setup.restoreMediaMirror')
    if (backup.mediaLocation === 'archive') return t('setup.restoreMediaArchive')
    if (backup.mediaLocation === 'mirror') return t('setup.restoreMediaMirror')
    return t('setup.restoreMediaStorage')
  }

  const accountForm = (
    <form onSubmit={handleSubmit}>
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
        <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
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
      <Button type="submit" disabled={isLoading}>
        {isLoading
          ? t(needsAccount ? 'setup.restoring' : 'common.loading')
          : t(needsAccount ? 'setup.restoreButton' : 'setup.createAccountButton')}
      </Button>
    </form>
  )

  return (
    <AuthShell logo={<AppIcon size={80} />}>
      <h1>{t(needsAccount ? 'setup.restoreAccountTitle' : 'setup.title')}</h1>

      {mode === 'create' && (
        <>
          <p>{t('setup.subtitle')}</p>
          {accountForm}
        </>
      )}

      {mode === 'restore' && needsAccount && (
        <>
          <p>{t('setup.restoreAccountHint')}</p>
          {accountForm}
          <p className="hint">{t('setup.restoreAfterHint')}</p>
        </>
      )}

      {mode === 'restore' && !needsAccount && (
        <>
          <p>{t('setup.restoreSubtitle')}</p>

          <section className="setup-restore-section" aria-labelledby="setup-volume-title">
            <h2 id="setup-volume-title">{t('setup.restoreVolumeTitle')}</h2>
            {backups === null ? (
              <p className="hint">{t('common.loading')}</p>
            ) : backups.length === 0 ? (
              <p className="hint">
                {t('setup.restoreVolumeNone')}{' '}
                <a href={RESTORE_DOCS_URL} target="_blank" rel="noreferrer">
                  {t('setup.restoreDocsLink')}
                </a>
              </p>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  if (selected) void runRestore({ kind: 'volume', file: selected })
                }}
              >
                <div className="setup-backup-list" role="radiogroup" aria-labelledby="setup-volume-title">
                  {backups.map((backup) => (
                    <label
                      key={backup.name}
                      className={`setup-backup${selected === backup.name ? ' is-selected' : ''}${backup.valid ? '' : ' is-invalid'}`}
                    >
                      <input
                        type="radio"
                        name="backup"
                        value={backup.name}
                        checked={selected === backup.name}
                        disabled={!backup.valid || isLoading}
                        onChange={() => setSelected(backup.name)}
                      />
                      <span className="setup-backup-body">
                        <span className="setup-backup-date">{new Date(backup.createdAt).toLocaleString()}</span>
                        <span className="setup-backup-meta">
                          <Badge variant={backup.type === 'dump' ? 'outline' : 'secondary'}>
                            {t(backup.type === 'dump' ? 'setup.restoreTypeDump' : 'setup.restoreTypeArchive')}
                          </Badge>
                          {backup.valid ? (
                            <>
                              <span>{formatBytes(backup.size)}</span>
                              <span>· {mediaLabel(backup)}</span>
                              {backup.serverVersion && (
                                <span>· {t('setup.restoreVersion', { version: backup.serverVersion })}</span>
                              )}
                            </>
                          ) : (
                            <span>{t('setup.restoreUnreadable')}</span>
                          )}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
                <p className="hint">{t('setup.restoreVolumeHint')}</p>
                <Button type="submit" disabled={isLoading || !selected}>
                  {isLoading ? t('setup.restoring') : t('setup.restoreSelectedButton')}
                </Button>
              </form>
            )}
          </section>

          <Separator />

          <section className="setup-restore-section" aria-labelledby="setup-upload-title">
            <h2 id="setup-upload-title">{t('setup.restoreUploadTitle')}</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (upload) void runRestore({ kind: 'upload', file: upload })
              }}
            >
              <label>
                {t('setup.restoreArchiveLabel')}
                <Input
                  type="file"
                  accept=".zip,application/zip"
                  onChange={(e) => setUpload(e.target.files?.[0] ?? null)}
                  required
                />
              </label>
              <p className="hint">{t('setup.restoreSourceHint')}</p>
              <Button type="submit" variant="outline" disabled={isLoading || !upload}>
                {isLoading ? t('setup.restoring') : t('setup.restoreButton')}
              </Button>
            </form>
          </section>

          <p className="hint">{t('setup.restoreSecretsHint')}</p>
        </>
      )}

      <Button variant="link" type="button" className="link-button" disabled={isLoading} onClick={switchMode}>
        {t(mode === 'restore' ? 'setup.modeCreate' : 'setup.modeRestore')}
      </Button>

      {error && (
        <StateMessage variant="error" className="error" role="alert">
          {error}
        </StateMessage>
      )}
      {missingMedia.length > 0 && (
        <div className="setup-missing-media">
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
