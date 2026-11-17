import { StateMessage } from '@famlin/ui/common/state-message'
import { Button } from '@famlin/ui/button'
import { SelectField } from '@famlin/ui/common/select-field'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  api,
  ApiError,
  type MediaAlbumLink,
  type MediaAlbumSummary,
  type MediaProviderId,
  type NewAssetMode,
} from '../../api/client'
import { useAdminDialogs } from '../AdminDialogs'
import { Icon } from '../Icon'

/**
 * The albums one family can pick photos from, for one media source: link,
 * unlink, and how new photos in each album are surfaced.
 */
export function GroupMediaAlbums({
  groupId,
  provider,
  onChange,
}: {
  groupId: string
  provider: MediaProviderId
  onChange?: () => void
}) {
  const { t } = useTranslation()
  const dialogs = useAdminDialogs()
  const [links, setLinks] = useState<MediaAlbumLink[] | null>(null)
  // `error`: the source is configured but its catalog couldn't be read —
  // distinct from notConfigured so the admin isn't told to "configure it".
  // Already-linked albums still show either way: they come from Famlin's DB.
  const [catalog, setCatalog] = useState<{
    albums: MediaAlbumSummary[] | null
    notConfigured: boolean
    error: boolean
  }>({ albums: null, notConfigured: false, error: false })
  const [selectedAlbumId, setSelectedAlbumId] = useState('')
  const [busy, setBusy] = useState(false)

  const loadLinks = useCallback(
    () =>
      api
        .getGroupMediaAlbums(groupId)
        .then((all) => setLinks(all.filter((link) => link.provider === provider)))
        .catch(() => setLinks([])),
    [groupId, provider]
  )

  useEffect(() => {
    loadLinks()
    api
      .getMediaAlbums(provider)
      .then((albums) => setCatalog({ albums, notConfigured: false, error: false }))
      .catch((err) => {
        const notConfigured = err instanceof ApiError && err.code === 'not_configured'
        setCatalog({ albums: null, notConfigured, error: !notConfigured })
      })
  }, [loadLinks, provider])

  const run = async (work: () => Promise<unknown>, errorKey: string) => {
    setBusy(true)
    try {
      await work()
      await loadLinks()
      onChange?.()
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('common.error')
      await dialogs.showMessage(t(errorKey, { error: message }))
    } finally {
      setBusy(false)
    }
  }

  const handleLink = async (e: React.FormEvent) => {
    e.preventDefault()
    const album = catalog.albums?.find((a) => a.id === selectedAlbumId)
    if (!album) return
    await run(async () => {
      await api.linkMediaAlbum(groupId, { provider, externalAlbumId: album.id, albumName: album.name })
      setSelectedAlbumId('')
    }, 'groups.mediaAlbums.linkError')
  }

  const handleUnlink = async (link: MediaAlbumLink) => {
    if (!(await dialogs.confirmAction(t('groups.mediaAlbums.unlinkConfirm', { name: link.albumName })))) return
    await run(() => api.unlinkMediaAlbum(link.id), 'groups.mediaAlbums.unlinkError')
  }

  const handleMode = (link: MediaAlbumLink, mode: NewAssetMode) =>
    run(() => api.updateMediaAlbumLink(link.id, { newAssetMode: mode }), 'groups.mediaAlbums.updateModeError')

  const linkable = (catalog.albums ?? []).filter((album) => !links?.some((l) => l.externalAlbumId === album.id))

  return (
    <>
      <div className="md-section-header">
        <h4>{t('groups.mediaAlbums.title')}</h4>
        <form className="md-add-member" onSubmit={handleLink}>
          {catalog.notConfigured ? (
            <span className="hint">{t('groups.mediaAlbums.notConfigured')}</span>
          ) : catalog.error ? (
            <span className="hint">{t('groups.mediaAlbums.loadError')}</span>
          ) : (
            <>
              <SelectField
                value={selectedAlbumId}
                onValueChange={(value) => setSelectedAlbumId(value)}
                disabled={linkable.length === 0}
                aria-label={t('groups.mediaAlbums.selectAlbum')}
                items={[
                  { value: '', label: <>{t('groups.mediaAlbums.selectAlbum')}</> },
                  ...linkable.map((album) => ({
                    value: album.id,
                    label: (
                      <>
                        {album.name} ({album.assetCount})
                      </>
                    ),
                  })),
                ]}
              />
              <Button type="submit" disabled={!selectedAlbumId || busy}>
                {t('groups.mediaAlbums.linkAlbum')}
              </Button>
            </>
          )}
        </form>
      </div>

      {links === null ? (
        <StateMessage variant="loading" className="loading">
          {t('common.loading')}
        </StateMessage>
      ) : links.length === 0 ? (
        <StateMessage variant="empty" className="empty">
          {t('groups.mediaAlbums.noAlbums')}
        </StateMessage>
      ) : (
        <ul className="member-cards">
          {links.map((link) => (
            <li key={link.id} className="member-card">
              <span className="member-card-info">
                <span className="member-card-name">{link.albumName}</span>
                <span className="member-card-sub">
                  {t('groups.mediaAlbums.newAssetMode')}:
                  <SelectField
                    value={link.newAssetMode}
                    onValueChange={(value) => handleMode(link, value as NewAssetMode)}
                    style={{ marginLeft: '0.5rem', fontSize: '0.9rem' }}
                    items={[
                      { value: 'OFF', label: <>{t('groups.mediaAlbums.newAssetMode.off')}</> },
                      { value: 'MANUAL', label: <>{t('groups.mediaAlbums.newAssetMode.manual')}</> },
                      { value: 'AUTO', label: <>{t('groups.mediaAlbums.newAssetMode.auto')}</> },
                    ]}
                  />
                </span>
                {link.newAssetMode !== 'OFF' && (
                  <span className="hint" style={{ marginTop: '0.25rem' }}>
                    {t(`groups.mediaAlbums.newAssetMode.${link.newAssetMode.toLowerCase()}Help`)}
                  </span>
                )}
              </span>
              <Button
                variant="destructive"
                size="icon"
                className="icon-button danger"
                title={t('common.remove')}
                aria-label={t('common.remove')}
                disabled={busy}
                onClick={() => handleUnlink(link)}
              >
                <Icon name="x" size={14} />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
