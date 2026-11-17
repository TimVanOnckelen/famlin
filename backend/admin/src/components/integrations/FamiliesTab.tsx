import { StateMessage } from '@famlin/ui/common/state-message'
import { Button } from '@famlin/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@famlin/ui/table'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, type Group, type MediaAlbumLink, type MediaMirrorOverview, type MediaProviderId } from '../../api/client'
import { AdminModal } from '../AdminModal'
import { MediaMirrorSection } from '../MediaMirrorSection'
import { GroupMediaAlbums } from './GroupMediaAlbums'

type Row = { group: Group; links: MediaAlbumLink[]; mirror: MediaMirrorOverview | null }

// One row per family: which albums of this media source it can pick from,
// and (Immich) where its uploads are mirrored. Editing opens the same
// controls the Groups page used to carry.
export function FamiliesTab({ provider }: { provider: MediaProviderId }) {
  const { t } = useTranslation()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [editing, setEditing] = useState<Group | null>(null)

  const load = useCallback(async () => {
    const groups = await api.getGroups()
    setRows(
      await Promise.all(
        groups.map(async (group) => ({
          group,
          links: (await api.getGroupMediaAlbums(group.id).catch(() => [])).filter((l) => l.provider === provider),
          mirror: provider === 'immich' ? await api.getMediaMirror(group.id).catch(() => null) : null,
        }))
      )
    )
  }, [provider])

  useEffect(() => {
    load()
  }, [load])

  if (!rows)
    return (
      <StateMessage variant="loading" className="loading">
        {t('common.loading')}
      </StateMessage>
    )
  if (rows.length === 0)
    return (
      <StateMessage variant="empty" className="empty">
        {t('integrations.families.none')}
      </StateMessage>
    )

  const mirrorCell = (mirror: MediaMirrorOverview | null) => {
    if (!mirror?.target) return <span className={`integration-chip off`}>{t('integrations.families.mirrorOff')}</span>
    const state = !mirror.target.enabled ? 'off' : mirror.counts.failed > 0 ? 'attention' : 'ok'
    return (
      <span className="integrations-mirror-cell">
        <span className={`integration-chip ${state}`}>
          {!mirror.target.enabled
            ? t('groups.mediaMirror.paused')
            : mirror.counts.failed > 0
              ? t('integrations.families.mirrorFailed', { count: mirror.counts.failed })
              : t('groups.mediaMirror.on')}
        </span>
        <span>
          {mirror.target.albumName} · {mirror.counts.mirrored}
        </span>
      </span>
    )
  }

  return (
    <>
      <div className="content-table">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('integrations.families.family')}</TableHead>
              <TableHead>{t('integrations.families.albums')}</TableHead>
              {provider === 'immich' && <TableHead>{t('integrations.families.mirror')}</TableHead>}
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ group, links, mirror }) => (
              <TableRow key={group.id}>
                <TableCell>
                  <strong>{group.name}</strong>
                </TableCell>
                <TableCell className={links.length ? '' : 'muted'}>
                  {links.length ? links.map((l) => l.albumName).join(', ') : '—'}
                </TableCell>
                {provider === 'immich' && <TableCell>{mirrorCell(mirror)}</TableCell>}
                <TableCell className="text-right">
                  <Button variant="secondary" size="sm" onClick={() => setEditing(group)}>
                    {links.length || mirror?.target ? t('common.edit') : t('integrations.setUp')}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {editing && (
        <AdminModal
          title={t('integrations.families.editTitle', { family: editing.name })}
          onClose={() => {
            setEditing(null)
            load()
          }}
        >
          <GroupMediaAlbums groupId={editing.id} provider={provider} />
          {provider === 'immich' && <MediaMirrorSection groupId={editing.id} groupName={editing.name} />}
        </AdminModal>
      )}
    </>
  )
}
