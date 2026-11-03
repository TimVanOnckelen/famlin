import { reportDevice } from '@famlin/api-client'
import { getDeviceReport, setDeviceReport } from '@/utils/storage'
import { syncDeviceDiagnostics } from '@/utils/deviceDiagnostics'

jest.mock('expo-constants', () => ({ expoConfig: { version: '1.8.2' }, nativeBuildVersion: '245' }))
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'install-uuid') }))
jest.mock('expo-device', () => ({ osVersion: '18.1' }))
jest.mock('expo-notifications', () => ({ getPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }) }))
jest.mock('react-native', () => ({ Platform: { OS: 'ios', Version: '18.1' } }))
jest.mock('@famlin/api-client', () => ({ reportDevice: jest.fn().mockResolvedValue(undefined) }))
jest.mock('@/utils/storage', () => ({
  getDeviceInstallId: jest.fn().mockResolvedValue('install-uuid'),
  setDeviceInstallId: jest.fn().mockResolvedValue(undefined),
  getDeviceReport: jest.fn().mockResolvedValue(null),
  setDeviceReport: jest.fn().mockResolvedValue(undefined),
  getServerUrl: jest.fn().mockResolvedValue('https://family.example'),
}))

describe('syncDeviceDiagnostics', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(getDeviceReport as jest.Mock).mockResolvedValue(null)
  })

  it('stores a report only after sending the current payload', async () => {
    const result = await syncDeviceDiagnostics('member-1')

    expect(reportDevice).toHaveBeenCalledWith('install-uuid', {
      platform: 'ios',
      osVersion: '18.1',
      appVersion: '1.8.2',
      appBuild: '245',
      pushPermission: 'granted',
    })
    expect(setDeviceReport).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ installId: 'install-uuid', changed: true })
  })

  it('does not call the server again for the same account/server/payload', async () => {
    await syncDeviceDiagnostics('member-1')
    const savedReport = (setDeviceReport as jest.Mock).mock.calls[0][0]
    ;(getDeviceReport as jest.Mock).mockResolvedValue(savedReport)
    ;(reportDevice as jest.Mock).mockClear()

    const result = await syncDeviceDiagnostics('member-1')

    expect(reportDevice).not.toHaveBeenCalled()
    expect(result).toMatchObject({ installId: 'install-uuid', changed: false })
  })

  it('reports again when the signed-in account changes', async () => {
    await syncDeviceDiagnostics('member-1')
    const savedReport = (setDeviceReport as jest.Mock).mock.calls[0][0]
    ;(getDeviceReport as jest.Mock).mockResolvedValue(savedReport)
    ;(reportDevice as jest.Mock).mockClear()

    await syncDeviceDiagnostics('member-2')

    expect(reportDevice).toHaveBeenCalledTimes(1)
  })
})
