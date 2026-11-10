import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Folder, KeyRound, Layers, RotateCcw, Trash2 } from 'lucide-react'
import { api, type StorageStatus, type StorageLocationStatus } from '../api/client'
import { Badge } from '@famlin/ui/badge'
import { Button } from '@famlin/ui/button'
import { Card } from '@famlin/ui/card'
import { Input } from '@famlin/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@famlin/ui/table'
import { FormField } from '@famlin/ui/common/form-field'
import { PageHeader } from '@famlin/ui/common/page-header'
import { SectionCard } from '@famlin/ui/common/section-card'
import { StateMessage } from '@famlin/ui/common/state-message'
import { formatBytes } from './SystemStatusPage'

function StorageLocation({
  location,
  fallback = false,
}: {
  location: StorageLocationStatus | null
  fallback?: boolean
}) {
  const { t } = useTranslation()
  const fields = location
    ? [
        [t('storage.driver'), location.driver === 's3' ? 'S3' : 'Local'],
        [t('storage.directory'), location.directory],
        [t('storage.bucket'), location.bucket],
        [t('storage.prefix'), location.driver === 's3' ? location.prefix || '/' : undefined],
        [t('storage.endpoint'), location.endpoint],
        [t('storage.region'), location.region],
      ]
    : []
  return (
    <SectionCard
      title={t(fallback ? 'storage.fallback' : 'storage.primary')}
      icon={fallback ? <Folder className="size-5" /> : <Layers className="size-5" />}
      badge={
        <Badge variant={!location ? 'outline' : location.available ? 'secondary' : 'destructive'}>
          {t(!location ? 'storage.notConfigured' : location.available ? 'storage.available' : 'storage.unavailable')}
        </Badge>
      }
    >
      {location ? (
        <>
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-lg bg-muted/50 p-4">
              <span className="block text-xs font-semibold text-muted-foreground">{t('storage.files')}</span>
              <strong className="mt-1 block text-2xl">{location.files?.toLocaleString() ?? '—'}</strong>
            </div>
            <div className="rounded-lg bg-muted/50 p-4">
              <span className="block text-xs font-semibold text-muted-foreground">{t('storage.size')}</span>
              <strong className="mt-1 block text-2xl">
                {location.bytes === null ? '—' : formatBytes(location.bytes)}
              </strong>
            </div>
          </div>
          <dl className="flex flex-col gap-3">
            {fields
              .filter(([, value]) => value !== undefined)
              .map(([label, value]) => (
                <div className="flex flex-wrap items-start justify-between gap-2 text-sm" key={label}>
                  <dt className="font-semibold">{label}</dt>
                  <dd className="min-w-0 break-all text-right text-muted-foreground">{value}</dd>
                </div>
              ))}
          </dl>
          {fallback && (
            <details className="rounded-lg bg-muted/50 p-3 text-sm">
              <summary className="cursor-pointer font-semibold">{t('storage.confirmSource')}</summary>
              <code className="mt-3 block break-all">{location.fingerprint}</code>
            </details>
          )}
        </>
      ) : (
        <p className="py-4 text-sm text-muted-foreground">{t('storage.notConfigured')}</p>
      )}
    </SectionCard>
  )
}

export function StoragePage() {
  const { t } = useTranslation()
  const states = t('storage.states', { returnObjects: true })
  const stateLabel = (state: string) => states[state as keyof typeof states] ?? state
  const [status, setStatus] = useState<StorageStatus | null>(null)
  const [error, setError] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    const refresh = () =>
      api
        .getStorage()
        .then((value) => {
          if (active) setStatus(value)
        })
        .catch((err) => {
          if (active) setError(String(err))
        })
    void refresh()
    const timer = setInterval(refresh, 5000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [])
  const run = async (cleanup: boolean) => {
    setBusy(true)
    setError('')
    try {
      if (cleanup) await api.cleanupStorage(confirmation)
      else await api.migrateStorage()
      setStatus(await api.getStorage())
      if (cleanup) setConfirmation('')
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }
  const running = ['running', 'cleaning'].includes(status?.migration?.status ?? '')
  const cleaning = status?.migration?.status === 'cleaning'
  const conflicts = status?.progress.some((row) => row.status === 'conflict' && row.files > 0)
  const canClean =
    !!status?.fallback &&
    !status.usingFallback &&
    !busy &&
    !running &&
    !conflicts &&
    ['verified', 'cleanup_failed', 'cleaned'].includes(status.migration?.status ?? '')
  return (
    <>
      <PageHeader title={t('storage.title')} />
      {error && <StateMessage variant="error">{error}</StateMessage>}
      {status?.usingFallback && <StateMessage variant="error">{t('storage.usingFallback')}</StateMessage>}
      {!status ? (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2" aria-busy="true">
          {[0, 1, 2].map((key) => (
            <Card key={key}>
              <StateMessage variant="loading">{t('common.loading')}</StateMessage>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <StorageLocation location={status.primary} />
          <StorageLocation location={status.fallback} fallback />
          <SectionCard
            title={t('storage.migrationTitle')}
            icon={<RotateCcw className="size-5" />}
            badge={
              !cleaning && (
                <Badge
                  variant={
                    status.migration?.status === 'failed' || conflicts
                      ? 'destructive'
                      : status.migration?.status === 'verified'
                        ? 'secondary'
                        : 'outline'
                  }
                >
                  {status.migration ? stateLabel(status.migration.status) : t('storage.idle')}
                </Badge>
              )
            }
          >
            <p className="text-sm text-muted-foreground">
              {t('storage.fallback')} <span aria-hidden="true">→</span> {t('storage.primary')}
            </p>
            {status.migration?.error && (
              <p role="alert" className="text-sm break-words text-destructive">
                {status.migration.error}
              </p>
            )}
            {status.progress.length > 0 ? (
              <Table stacked>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('storage.state')}</TableHead>
                    <TableHead>{t('storage.files')}</TableHead>
                    <TableHead>{t('storage.size')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {status.progress.map((row) => (
                    <TableRow key={row.status}>
                      <TableCell>{stateLabel(row.status)}</TableCell>
                      <TableCell label={t('storage.files')}>{row.files.toLocaleString()}</TableCell>
                      <TableCell label={t('storage.size')}>{formatBytes(row.bytes)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="py-4 text-sm text-muted-foreground">{t('storage.idle')}</p>
            )}
            {status.errors.length > 0 && (
              <details className="rounded-lg bg-muted/50 p-3 text-sm">
                <summary className="cursor-pointer font-semibold">
                  {t('storage.errors', { count: status.errors.length })}
                </summary>
                <ul className="mt-3 flex flex-col gap-2">
                  {status.errors.map((row) => (
                    <li key={row.key}>
                      <code className="break-all">{row.key}</code>
                      <span className="block text-destructive">{row.error}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <div>
              <Button
                disabled={busy || !status.fallback || status.usingFallback || running}
                onClick={() => void run(false)}
              >
                {t('storage.migrate')}
              </Button>
            </div>
          </SectionCard>
          {status.fallback && (
            <SectionCard
              className="xl:col-span-2"
              title={t('storage.cleanup')}
              icon={<Trash2 className="size-5" />}
              badge={
                status.migration && ['cleaning', 'cleaned', 'cleanup_failed'].includes(status.migration.status) ? (
                  <Badge
                    variant={cleaning ? 'outline' : status.migration.status === 'cleaned' ? 'secondary' : 'destructive'}
                  >
                    {stateLabel(status.migration.status)}
                  </Badge>
                ) : undefined
              }
            >
              <p className="text-sm text-muted-foreground">{t('storage.cleanupHint')}</p>
              {!canClean && <p className="text-sm text-muted-foreground">{t('storage.cleanupLocked')}</p>}
              <form
                className="flex flex-col gap-4 sm:flex-row sm:items-end"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (canClean && confirmation === status.fallback?.fingerprint) void run(true)
                }}
              >
                <FormField label={t('storage.confirmSource')} htmlFor="storage-source-fingerprint" className="flex-1">
                  <Input
                    id="storage-source-fingerprint"
                    type="text"
                    value={confirmation}
                    disabled={!canClean}
                    onChange={(event) => setConfirmation(event.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={t('storage.confirmPlaceholder')}
                  />
                </FormField>
                <Button
                  type="submit"
                  variant="destructive"
                  disabled={!canClean || confirmation !== status.fallback.fingerprint}
                >
                  {t('storage.cleanup')}
                </Button>
              </form>
              <p className="text-xs text-muted-foreground">{t('storage.removeFallback')}</p>
            </SectionCard>
          )}
          <p className="flex items-start gap-2 text-sm text-muted-foreground xl:col-span-2">
            <KeyRound className="mt-0.5 size-4 shrink-0" />
            {t('storage.description')}
          </p>
        </div>
      )}
    </>
  )
}
