import { SectionCard } from '@famlin/ui/common/section-card'
import { ConfirmDialog } from '@famlin/ui/common/confirm-dialog'
import { StateMessage } from '@famlin/ui/common/state-message'
import { Badge } from '@famlin/ui/badge'
import { Button } from '@famlin/ui/button'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, type BackupEncryption } from '../api/client'
import { AdminModal } from './AdminModal'
import { CheckboxField } from './CheckboxField'
import { Icon } from './Icon'

const ENCRYPTION_DOCS_URL = 'https://famlin.app/docs/maintenance#encrypting-backups'

// `age1qyz…k3fx`: enough to tell keys apart in the UI and in the kit file.
export function shortKeyId(id: string): string {
  return id.length > 18 ? `${id.slice(0, 10)}…${id.slice(-6)}` : id
}

// Backup encryption (issue #495), modelled on Home Assistant's: the server
// generates the key; turning encryption on requires downloading the
// emergency kit and confirming it's stored somewhere other than this server.
export function BackupEncryptionCard({
  encryption,
  onChange,
}: {
  encryption: BackupEncryption
  onChange: (encryption: BackupEncryption) => void
}) {
  const { t } = useTranslation()
  const [setupOpen, setSetupOpen] = useState(false)
  const [kitDownloaded, setKitDownloaded] = useState(false)
  const [kitSaved, setKitSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmRotate, setConfirmRotate] = useState(false)
  const [confirmOff, setConfirmOff] = useState(false)
  const [rotated, setRotated] = useState(false)

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const openSetup = () => {
    setKitDownloaded(false)
    setKitSaved(false)
    setError(null)
    setSetupOpen(true)
  }

  // First use generates the key; the kit is then the current key's.
  const downloadSetupKit = () =>
    run(async () => {
      if (!encryption.currentKey) onChange((await api.generateBackupKey()).encryption)
      await api.downloadEmergencyKit()
      setKitDownloaded(true)
    })

  const turnOn = () =>
    run(async () => {
      onChange((await api.setBackupEncryption(true, true)).encryption)
      setSetupOpen(false)
    })

  const rotate = () =>
    run(async () => {
      onChange((await api.generateBackupKey()).encryption)
      setConfirmRotate(false)
      setRotated(true)
      await api.downloadEmergencyKit()
    })

  const turnOff = () =>
    run(async () => {
      onChange((await api.setBackupEncryption(false)).encryption)
      setConfirmOff(false)
    })

  const olderKeys = encryption.keys.filter((k) => k.id !== encryption.currentKey?.id)

  return (
    <SectionCard
      title={t('backupEncryption.title')}
      icon={<Icon name="shield" size={20} />}
      description={t('backupEncryption.desc')}
    >
      {error && !setupOpen && (
        <StateMessage variant="error" className="error" role="alert">
          {error}
        </StateMessage>
      )}
      {encryption.enabled && encryption.currentKey ? (
        <>
          <div className="backup-encryption-status">
            <Badge variant="accent">{t('backupEncryption.on')}</Badge>
            <span>
              {t('backupEncryption.onBody', {
                key: shortKeyId(encryption.currentKey.id),
                date: new Date(encryption.currentKey.createdAt).toLocaleDateString(),
              })}
            </span>
          </div>
          <p className="backup-encryption-warning">{t('backupEncryption.mirrorWarning')}</p>
          {rotated && <p className="hint">{t('backupEncryption.rotatedNotice')}</p>}
          <div className="backups-save-row">
            <Button variant="secondary" disabled={busy} onClick={() => run(() => api.downloadEmergencyKit())}>
              {t('backupEncryption.downloadKit')}
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => setConfirmRotate(true)}>
              {t('backupEncryption.rotate')}
            </Button>
            <Button variant="ghost" className="text-destructive" disabled={busy} onClick={() => setConfirmOff(true)}>
              {t('backupEncryption.turnOff')}
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="backup-encryption-status">
            <Badge variant="outline">{t('backupEncryption.off')}</Badge>
            <span>{t('backupEncryption.offBody')}</span>
          </div>
          <div className="backups-save-row">
            <Button disabled={busy} onClick={openSetup}>
              {t('backupEncryption.setUp')}
            </Button>
            <a href={ENCRYPTION_DOCS_URL} target="_blank" rel="noreferrer" className="hint">
              {t('backupEncryption.docsLink')}
            </a>
          </div>
        </>
      )}

      {olderKeys.length > 0 && (
        <details className="backup-encryption-keys">
          <summary>{t('backupEncryption.olderKeys', { count: olderKeys.length })}</summary>
          <p className="hint">{t('backupEncryption.olderKeysHint')}</p>
          <ul>
            {olderKeys.map((key) => (
              <li key={key.id}>
                <code>{shortKeyId(key.id)}</code>
                <span className="muted">{new Date(key.createdAt).toLocaleDateString()}</span>
                <Button
                  variant="link"
                  size="sm"
                  disabled={busy}
                  onClick={() => run(() => api.downloadEmergencyKit(key.id))}
                >
                  {t('backupEncryption.downloadKit')}
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {setupOpen && (
        <AdminModal
          title={t('backupEncryption.setupTitle')}
          onClose={() => setSetupOpen(false)}
          descriptionId="backup-encryption-setup-desc"
        >
          <div className="backups-restore-form">
            <p id="backup-encryption-setup-desc">{t('backupEncryption.setupIntro')}</p>
            <ul className="backups-restore-list">
              <li>{t('backupEncryption.setupPointKit')}</li>
              <li>{t('backupEncryption.setupPointLost')}</li>
              <li>{t('backupEncryption.setupPointServer')}</li>
              <li>{t('backupEncryption.mirrorWarning')}</li>
            </ul>
            <div>
              <Button type="button" variant="secondary" disabled={busy} onClick={downloadSetupKit}>
                {kitDownloaded ? t('backupEncryption.downloadKitAgain') : t('backupEncryption.downloadKit')}
              </Button>
            </div>
            <CheckboxField
              label={t('backupEncryption.kitSavedLabel')}
              checked={kitSaved}
              onChange={(checked) => setKitSaved(checked && kitDownloaded)}
            />
            {!kitDownloaded && <p className="hint">{t('backupEncryption.downloadFirst')}</p>}
            {error && <p className="test-err">{error}</p>}
            <div className="backups-restore-actions">
              <Button type="button" variant="ghost" onClick={() => setSetupOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="button" disabled={!kitDownloaded || !kitSaved || busy} onClick={turnOn}>
                {t('backupEncryption.turnOn')}
              </Button>
            </div>
          </div>
        </AdminModal>
      )}

      <ConfirmDialog
        open={confirmRotate}
        onOpenChange={(open) => !open && setConfirmRotate(false)}
        title={t('backupEncryption.rotateTitle')}
        description={t('backupEncryption.rotateBody')}
        confirmLabel={t('backupEncryption.rotateConfirm')}
        cancelLabel={t('common.cancel')}
        onConfirm={rotate}
        busy={busy}
      />
      <ConfirmDialog
        open={confirmOff}
        onOpenChange={(open) => !open && setConfirmOff(false)}
        title={t('backupEncryption.turnOffTitle')}
        description={t('backupEncryption.turnOffBody')}
        confirmLabel={t('backupEncryption.turnOff')}
        cancelLabel={t('common.cancel')}
        onConfirm={turnOff}
        busy={busy}
      />
    </SectionCard>
  )
}
