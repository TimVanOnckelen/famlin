import Constants from 'expo-constants'
import * as Crypto from 'expo-crypto'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'
import { reportDevice, DevicePayload } from '@famlin/api-client'
import { getDeviceInstallId, setDeviceInstallId, getDeviceReport, setDeviceReport, getServerUrl } from '@/utils/storage'
import { checkServerSupports } from '@/utils/serverFeatures'

export async function getOrCreateDeviceInstallId(): Promise<string> {
  const existing = await getDeviceInstallId()
  if (existing) return existing

  const installId = Crypto.randomUUID()
  await setDeviceInstallId(installId)
  return installId
}

export async function syncDeviceDiagnostics(userId: string) {
  if (Platform.OS === 'web') return null

  const [installId, serverUrl, permissions] = await Promise.all([
    getOrCreateDeviceInstallId(),
    getServerUrl(),
    Notifications.getPermissionsAsync(),
  ])
  if (!serverUrl) throw new Error('No server URL is configured')

  const payload: DevicePayload = {
    platform: Platform.OS as 'ios' | 'android',
    osVersion: Device.osVersion ?? String(Platform.Version),
    appVersion: Constants.expoConfig?.version ?? 'unknown',
    appBuild: Constants.nativeBuildVersion ?? 'unknown',
    pushPermission:
      permissions.status === 'granted' ? 'granted' : permissions.status === 'denied' ? 'denied' : 'undetermined',
  }
  const reportKey = JSON.stringify({ serverUrl, userId, installId, payload })
  if ((await getDeviceReport()) === reportKey) return { installId, payload, changed: false }

  // A server without /api/devices (before deviceDiagnostics) gets nothing:
  // skipped silently, and nothing stored, so it reports once the server is
  // upgraded.
  if (!(await checkServerSupports('deviceDiagnostics'))) return null

  await reportDevice(installId, payload)
  // Store only after the server accepted the report. Failed requests retry on
  // the next launch/foreground event, without recording an app-open signal.
  await setDeviceReport(reportKey)
  return { installId, payload, changed: true }
}
