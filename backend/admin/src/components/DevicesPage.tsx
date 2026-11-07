import { InitialAvatar } from './common/InitialAvatar'
import { PageHeader } from '@famlin/ui/common/page-header'
import { StateMessage } from '@famlin/ui/common/state-message'
import { Card } from '@famlin/ui/card'
import { Button } from '@famlin/ui/button'
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@famlin/ui/table'
import { Badge } from '@famlin/ui/badge'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, type AdminDevice, type DeviceSummary } from '../api/client'
import { useAdminDialogs } from './AdminDialogs'

export function DevicesPage() {
  const { t } = useTranslation()
  const dialogs = useAdminDialogs()
  const [devices, setDevices] = useState<AdminDevice[]>([])
  const [summary, setSummary] = useState<DeviceSummary | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const page = await api.getDevices()
      setDevices(page.items)
      setSummary(page.summary)
      setNextCursor(page.nextCursor)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  async function loadMore() {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      const page = await api.getDevices({ cursor: nextCursor })
      setDevices((current) => [...current, ...page.items])
      setNextCursor(page.nextCursor)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'))
    } finally {
      setLoadingMore(false)
    }
  }

  async function removeDevice(device: AdminDevice) {
    const confirmed = await dialogs.confirmAction(t('devices.removeConfirm', { name: device.user.name }))
    if (!confirmed) return
    try {
      await api.deleteDevice(device.id)
      await load()
    } catch (err) {
      await dialogs.showMessage(
        t('devices.removeError', { error: err instanceof Error ? err.message : t('common.error') })
      )
    }
  }

  return (
    <>
      <PageHeader title={t('devices.title')} />
      <p className="md-hint">{t('devices.description')}</p>

      {summary && (
        <div className="devices-summary">
          <Card className="p-6 gap-4">
            <span>{t('devices.totalDevices')}</span>
            <strong>{summary.total}</strong>
          </Card>
          <Card className="p-6 gap-4">
            <span>{t('devices.pushDenied')}</span>
            <strong>{summary.pushDenied}</strong>
          </Card>
          <Card className="p-6 gap-4 devices-versions">
            <span>{t('devices.appVersions')}</span>
            {summary.versions.length === 0 ? (
              <strong>—</strong>
            ) : (
              <div>
                {summary.versions.map(({ appVersion, platform, count }) => (
                  <span className="devices-version" key={`${appVersion}-${platform}`}>
                    {t('devices.versionPlatform', { version: appVersion, platform })}: {count}
                  </span>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      <Card className="p-6 gap-4">
        {error && (
          <StateMessage variant="error" className="error" role="alert">
            {error}{' '}
            <Button variant="secondary" className="secondary" onClick={() => void load()}>
              {t('common.retry')}
            </Button>
          </StateMessage>
        )}
        {loading ? (
          <StateMessage variant="loading" className="loading">
            {t('common.loading')}
          </StateMessage>
        ) : devices.length === 0 ? (
          <StateMessage variant="empty" className="empty">
            {t('devices.empty')}
          </StateMessage>
        ) : (
          <div className="content-table">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('devices.member')}</TableHead>
                  <TableHead>{t('devices.installId')}</TableHead>
                  <TableHead>{t('devices.platform')}</TableHead>
                  <TableHead>{t('devices.osVersion')}</TableHead>
                  <TableHead>{t('devices.appVersion')}</TableHead>
                  <TableHead>{t('devices.appBuild')}</TableHead>
                  <TableHead>{t('devices.pushPermission')}</TableHead>
                  <TableHead>{t('common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {devices.map((device) => (
                  <TableRow key={device.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <InitialAvatar name={device.user.name} avatarUrl={device.user.avatarUrl} />
                        <div className="min-w-0">
                          {' '}
                          <strong className="device-member-name">{device.user.name}</strong>
                          <span className="cell-sub device-member-email">{device.user.email}</span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="device-install-id">{device.installId}</TableCell>
                    <TableCell>{device.platform}</TableCell>
                    <TableCell>{device.osVersion}</TableCell>
                    <TableCell>{device.appVersion}</TableCell>
                    <TableCell>{device.appBuild}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          device.pushPermission === 'denied'
                            ? 'destructive'
                            : device.pushPermission === 'granted'
                              ? 'success'
                              : 'outline'
                        }
                      >
                        {t(`devices.permissions.${device.pushPermission}`)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button variant="destructive" className="danger" onClick={() => void removeDevice(device)}>
                        {t('devices.remove')}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {!loading && nextCursor && (
          <div className="load-more">
            <Button variant="secondary" className="secondary" disabled={loadingMore} onClick={() => void loadMore()}>
              {loadingMore ? t('common.loading') : t('common.loadMore')}
            </Button>
          </div>
        )}
      </Card>
    </>
  )
}
