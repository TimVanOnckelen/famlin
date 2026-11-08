import { reportDevice } from '@famlin/api-client'
import { getDeviceReport, setDeviceReport } from '@/utils/storage'
import { syncDeviceDiagnostics } from '@/utils/deviceDiagnostics'
import { checkServerFeature } from '@/utils/serverFeatures'

jest.mock('expo-constants', () => ({ expoConfig: { version: '1.8.2' }, nativeBuildVersion: '245' }))
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'install-uuid') }))
jest.mock('expo-device', () => ({ osVersion: '18.1' }))
jest.mock('expo-notifications', () => ({ getPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }) }))
jest.mock('react-native', () => ({ Platform: { OS: 'ios', Version: '18.1' } }))
jest.mock('@famlin/api-client', () => ({
  reportDevice: jest.fn().mockResolvedValue(undefined),
  isNotFoundError: jest.requireActual('@famlin/api-client').isNotFoundError,
}))
jest.mock('@/utils/serverFeatures', () => ({ checkServerFeature: jest.fn() }))
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
    jest.mocked(checkServerFeature).mockResolvedValue('supported')
  })

  it('skips silently, storing nothing, on a server that says it lacks deviceDiagnostics', async () => {
    jest.mocked(checkServerFeature).mockResolvedValue('unsupported')

    const result = await syncDeviceDiagnostics('member-1')

    expect(checkServerFeature).toHaveBeenCalledWith('deviceDiagnostics')
    expect(reportDevice).not.toHaveBeenCalled()
    expect(setDeviceReport).not.toHaveBeenCalled()
    expect(result).toBeNull()
  })

  it('tries on a server too old to say, and swallows its 404 without storing anything', async () => {
    jest.mocked(checkServerFeature).mockResolvedValue('unknown')
    jest
      .mocked(reportDevice)
      .mockRejectedValueOnce(Object.assign(new Error('Not Found'), { response: { status: 404 } }))

    const result = await syncDeviceDiagnostics('member-1')

    expect(reportDevice).toHaveBeenCalledTimes(1)
    expect(setDeviceReport).not.toHaveBeenCalled()
    expect(result).toBeNull()
  })

  it('still surfaces non-404 failures', async () => {
    jest.mocked(checkServerFeature).mockResolvedValue('unknown')
    jest.mocked(reportDevice).mockRejectedValueOnce(Object.assign(new Error('boom'), { response: { status: 500 } }))

    await expect(syncDeviceDiagnostics('member-1')).rejects.toThrow('boom')
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
