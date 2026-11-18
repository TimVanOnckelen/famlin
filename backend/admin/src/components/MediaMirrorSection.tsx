import { StateMessage } from '@famlin/ui/common/state-message'
import { Badge } from '@famlin/ui/badge'
import { Button } from '@famlin/ui/button'
import { Input } from '@famlin/ui/input'
import { SelectField } from '@famlin/ui/common/select-field'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, ApiError, type MediaAlbumSummary, type MediaMirrorOverview } from '../api/client'
import { useAdminDialogs } from './AdminDialogs'

const CREATE = '__create__'

/**
 * Opt-in Famlin -> Immich upload mirror for one family (issue #420).
 *
 * Turning it on asks for an explicit confirmation of the privacy trade-off:
 * who can see the Immich album is managed in Immich, not by Famlin family
 * membership, so someone removed from the family keeps seeing what was
 * already mirrored. Circle, gift-list and story media are never mirrored.
 */
export function MediaMirrorSection({ groupId, groupName }: { groupId: string; groupName: string }) {
  const { t } = useTranslation()
  const dialogs = useAdminDialogs()
  const [overview, setOverview] = useState<MediaMirrorOverview | null>(null)
  const [albums, setAlbums] = useState<MediaAlbumSummary[] | null>(null)
  const [albumChoice, setAlbumChoice] = useState(CREATE)
  const [since, setSince] = useState('')
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    let cancelled = false
    api
      .getMediaMirror(groupId)
      .then((next) => !cancelled && setOverview(next))
      .catch((err) => !cancelled && setLoadError(err instanceof Error ? err.message : t('common.error')))
    return () => {
      cancelled = true
    }
  }, [groupId, t])

  useEffect(() => {
    if (!overview?.configured || overview.target) return
    api
      .getMediaAlbums('immich')
      .then(setAlbums)
      .catch(() => setAlbums([]))
  }, [overview?.configured, overview?.target])

  const run = async (work: () => Promise<MediaMirrorOverview | void>) => {
    setBusy(true)
    try {
      const next = await work()
      if (next) setOverview(next)
    } catch (err) {
      const message = err instanceof ApiError || err instanceof Error ? err.message : t('common.error')
      await dialogs.showMessage(t('groups.mediaMirror.error', { error: message }))
    } finally {
      setBusy(false)
    }
  }

  const handleEnable = async () => {
    if (!(await dialogs.confirmAction(t('groups.mediaMirror.enableConfirm')))) return
    const existing = albums?.find((album) => album.id === albumChoice)
    await run(() =>
      api.updateMediaMirror(groupId, {
        enabled: true,
        album: existing
          ? { mode: 'existing', externalAlbumId: existing.id, albumName: existing.name }
          : { mode: 'create' },
        ...(since ? { mirrorSince: new Date(`${since}T00:00:00`).toISOString() } : {}),
      })
    )
  }

  if (loadError) return <span className="hint">{loadError}</span>
  if (!overview) {
    return (
      <StateMessage variant="loading" className="loading">
        {t('common.loading')}
      </StateMessage>
    )
  }

  const { target, counts } = overview

  return (
    <>
      <div className="md-section-header">
        <h4>{t('groups.mediaMirror.title')}</h4>
        {target && (
          <Badge variant={target.enabled ? 'default' : 'secondary'} className="badge">
            {target.enabled ? t('groups.mediaMirror.on') : t('groups.mediaMirror.paused')}
          </Badge>
        )}
      </div>
      <p className="hint">{t('groups.mediaMirror.description')}</p>

      {!target && !overview.configured && <p className="hint">{t('groups.mediaMirror.notConfigured')}</p>}

      {!target && overview.configured && (
        <div className="mirror-setup">
          <SelectField
            value={albumChoice}
            onValueChange={(value) => setAlbumChoice(value)}
            aria-label={t('groups.mediaMirror.album')}
            items={[
              { value: CREATE, label: <>{t('groups.mediaMirror.createAlbum', { name: `Famlin – ${groupName}` })}</> },
              ...(albums ?? []).map((album) => ({ value: album.id, label: <>{album.name}</> })),
            ]}
          />
          <label className="hint">
            {t('groups.mediaMirror.since')}
            <Input type="date" value={since} onChange={(e) => setSince(e.target.value)} />
          </label>
          <Button type="button" disabled={busy} onClick={handleEnable}>
            {t('groups.mediaMirror.enable')}
          </Button>
        </div>
      )}

      {target && (
        <>
          <ul className="member-cards">
            <li className="member-card">
              <span className="member-card-info">
                <span className="member-card-name">{target.albumName}</span>
                <span className="member-card-sub">{t('groups.mediaMirror.counts', counts)}</span>
                <span className="member-card-sub">
                  {t('groups.mediaMirror.sinceValue', { date: new Date(target.mirrorSince).toLocaleDateString() })}
                  {' · '}
                  {target.lastSyncedAt
                    ? t('groups.mediaMirror.lastSynced', { date: new Date(target.lastSyncedAt).toLocaleString() })
                    : t('groups.mediaMirror.neverSynced')}
                </span>
              </span>
            </li>
          </ul>
          {overview.failures.length > 0 && (
            <ul className="hint">
              {overview.failures.map((failure) => (
                <li key={failure.assetKey}>
                  <code>{failure.assetKey}</code>: {failure.lastError ?? t('common.error')} (
                  {t('groups.mediaMirror.attempts', { count: failure.attempts, max: overview.maxAttempts })})
                </li>
              ))}
            </ul>
          )}
          <p className="hint">{t('groups.mediaMirror.pauseHint')}</p>
          <div className="settings-test-row">
            <Button
              variant="secondary"
              type="button"
              disabled={busy || !target.enabled}
              onClick={() =>
                run(async () => {
                  const { started } = await api.syncMediaMirror(groupId)
                  await dialogs.showMessage(
                    t(started ? 'groups.mediaMirror.syncStarted' : 'groups.mediaMirror.syncAlreadyRunning')
                  )
                })
              }
            >
              {t('groups.mediaMirror.syncNow')}
            </Button>
            <Button
              variant="secondary"
              type="button"
              disabled={busy}
              onClick={() => run(() => api.updateMediaMirror(groupId, { enabled: !target.enabled }))}
            >
              {target.enabled ? t('groups.mediaMirror.pause') : t('groups.mediaMirror.resume')}
            </Button>
          </div>
        </>
      )}
    </>
  )
}
