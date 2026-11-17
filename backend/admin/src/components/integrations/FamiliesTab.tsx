import { StateMessage } from '@famlin/ui/common/state-message'
import { Button } from '@famlin/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@famlin/ui/table'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { IntegrationFamily, MediaProviderId } from '../../api/client'
import { AdminModal } from '../AdminModal'
import { MediaMirrorSection } from '../MediaMirrorSection'
import { GroupMediaAlbums } from './GroupMediaAlbums'
import { StateChip } from './StateChip'

// One row per family: which albums of this media source it can pick from,
// and (Immich) where its uploads are mirrored. Editing opens the same
// controls the Groups page used to carry; closing reloads the summary.
export function FamiliesTab({
  provider,
  families,
  onChange,
}: {
  provider: MediaProviderId
  families: IntegrationFamily[]
  onChange: () => void
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState<IntegrationFamily | null>(null)

  if (families.length === 0)
    return (
      <StateMessage variant="empty" className="empty">
        {t('integrations.families.none')}
      </StateMessage>
    )

  const mirrorCell = ({ mirror }: IntegrationFamily) => {
    if (!mirror) return <StateChip state="off">{t('integrations.families.mirrorOff')}</StateChip>
    const state = !mirror.enabled ? 'off' : mirror.failed > 0 ? 'attention' : 'ok'
    return (
      <span className="integrations-mirror-cell">
        <StateChip state={state}>
          {!mirror.enabled
            ? t('groups.mediaMirror.paused')
            : mirror.failed > 0
              ? t('integrations.families.mirrorFailed', { count: mirror.failed })
              : t('groups.mediaMirror.on')}
        </StateChip>
        <span>
          {mirror.albumName} · {mirror.mirrored}
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
            {families.map((family) => (
              <TableRow key={family.groupId}>
                <TableCell>
                  <strong>{family.name}</strong>
                </TableCell>
                <TableCell className={family.albums.length ? '' : 'muted'}>
                  {family.albums.length ? family.albums.join(', ') : '—'}
                </TableCell>
                {provider === 'immich' && <TableCell>{mirrorCell(family)}</TableCell>}
                <TableCell className="text-right">
                  <Button variant="secondary" size="sm" onClick={() => setEditing(family)}>
                    {family.albums.length || family.mirror ? t('common.edit') : t('integrations.setUp')}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {editing && (
        <AdminModal
          title={editing.name}
          onClose={() => {
            setEditing(null)
            onChange()
          }}
        >
          <GroupMediaAlbums groupId={editing.groupId} provider={provider} />
          {provider === 'immich' && <MediaMirrorSection groupId={editing.groupId} groupName={editing.name} />}
        </AdminModal>
      )}
    </>
  )
}
