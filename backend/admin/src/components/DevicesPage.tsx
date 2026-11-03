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
      <div className="page-header">
        <h2>{t('devices.title')}</h2>
      </div>
      <p className="md-hint">{t('devices.description')}</p>

      {summary && (
        <div className="devices-summary">
          <div className="card">
            <span>{t('devices.totalDevices')}</span>
            <strong>{summary.total}</strong>
          </div>
          <div className="card">
            <span>{t('devices.pushDenied')}</span>
            <strong>{summary.pushDenied}</strong>
          </div>
          <div className="card devices-versions">
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
          </div>
        </div>
      )}

      <section className="card">
        {error && (
          <div className="error" role="alert">
            {error}{' '}
            <button className="secondary" onClick={() => void load()}>
              {t('common.retry')}
            </button>
          </div>
        )}
        {loading ? (
          <div className="loading">{t('common.loading')}</div>
        ) : devices.length === 0 ? (
          <div className="empty">{t('devices.empty')}</div>
        ) : (
          <div className="content-table">
            <table>
              <thead>
                <tr>
                  <th>{t('devices.member')}</th>
                  <th>{t('devices.installId')}</th>
                  <th>{t('devices.platform')}</th>
                  <th>{t('devices.osVersion')}</th>
                  <th>{t('devices.appVersion')}</th>
                  <th>{t('devices.appBuild')}</th>
                  <th>{t('devices.pushPermission')}</th>
                  <th>{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {devices.map((device) => (
                  <tr key={device.id}>
                    <td>
                      <strong className="device-member-name">{device.user.name}</strong>
                      <span className="cell-sub device-member-email">{device.user.email}</span>
                    </td>
                    <td className="device-install-id">{device.installId}</td>
                    <td>{device.platform}</td>
                    <td>{device.osVersion}</td>
                    <td>{device.appVersion}</td>
                    <td>{device.appBuild}</td>
                    <td>
                      <span
                        className={`badge ${
                          device.pushPermission === 'denied'
                            ? 'err'
                            : device.pushPermission === 'granted'
                              ? 'ok'
                              : 'off'
                        }`}
                      >
                        {t(`devices.permissions.${device.pushPermission}`)}
                      </span>
                    </td>
                    <td>
                      <button className="danger" onClick={() => void removeDevice(device)}>
                        {t('devices.remove')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!loading && nextCursor && (
          <div className="load-more">
            <button className="secondary" disabled={loadingMore} onClick={() => void loadMore()}>
              {loadingMore ? t('common.loading') : t('common.loadMore')}
            </button>
          </div>
        )}
      </section>
    </>
  )
}
