import React from 'react'
import { Alert } from 'react-native'
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fetchMyDevices, fetchMyGiftLists, fetchServerInfo, getMyExportRequest } from '@famlin/api-client'

import { ProfileScreen } from '@/screens/ProfileScreen'
import { useAuthStore } from '@/stores/authStore'

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}))
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }) }))
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }: any) => children }))
jest.mock('@/components/KeyboardAware', () => ({ KeyboardAwareScrollView: ({ children }: any) => children }))
jest.mock('@/components/Icon', () => ({ Icon: () => null }))
jest.mock('@/components/Logo', () => ({ Logo: () => null }))
jest.mock('@/components/Avatar', () => ({ Avatar: () => null }))
jest.mock('@/hooks/usePickAndUploadMedia', () => ({
  usePickAndUploadMedia: () => ({ pick: jest.fn(), uploading: false }),
}))
jest.mock('expo-image-picker', () => ({ MediaTypeOptions: { Images: 'Images' } }))
jest.mock('expo-file-system', () => ({ File: jest.fn(), Paths: {} }))
jest.mock('expo-sharing', () => ({ shareAsync: jest.fn() }))

jest.mock('@famlin/api-client', () => ({
  ...jest.requireActual('@famlin/api-client'),
  getCurrentServerUrl: () => 'https://family.example',
  fetchServerInfo: jest.fn(),
  fetchMyGiftLists: jest.fn(),
  fetchMyDevices: jest.fn(),
  getMyExportRequest: jest.fn(),
  fetchNotificationConfig: jest.fn().mockResolvedValue({ pushEnabled: true, emailEnabled: true }),
}))

const ALL = ['giftLists', 'deviceDiagnostics', 'memberExport', 'accountDeletion']

// `serverInfo` primes the cache, as the feed has normally loaded it already.
function renderProfile(serverInfo?: object) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  if (serverInfo) client.setQueryData(['server-info', 'https://family.example'], serverInfo)
  return render(
    <QueryClientProvider client={client}>
      <ProfileScreen />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  useAuthStore.setState({
    user: { id: 'u1', name: 'Ann', email: 'ann@example.com', isAdmin: false, hasPassword: false } as never,
    serverUrl: 'https://family.example',
  })
  jest
    .mocked(fetchMyGiftLists)
    .mockResolvedValue([
      { id: 'p1', type: 'GIFT_LIST', typeData: { title: 'Christmas' }, giftList: { title: 'Christmas' } } as never,
    ])
  jest.mocked(fetchMyDevices).mockResolvedValue([])
})
afterEach(() => jest.clearAllMocks())

it('shows the export, delete, devices and gift list sections on a server that supports them', async () => {
  jest.mocked(fetchServerInfo).mockResolvedValue({ version: '0.9.0', features: ALL } as never)
  await renderProfile()
  expect(await screen.findByText('profile.exportButton')).toBeTruthy()
  expect(screen.getByText('profile.deleteAccount')).toBeTruthy()
  expect(await screen.findByText('profile.devices.title')).toBeTruthy()
  expect(await screen.findByText('profile.myGiftLists')).toBeTruthy()
  expect(fetchMyGiftLists).toHaveBeenCalled()
  expect(fetchMyDevices).toHaveBeenCalled()
})

it('hides them, and never queries gift lists or devices, on a server that says it lacks them', async () => {
  await renderProfile({ version: '0.9.0', features: ['stories'] })
  expect(await screen.findByText('profile.logout')).toBeTruthy()
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(screen.queryByText('profile.exportButton')).toBeNull()
  expect(screen.queryByText('profile.deleteAccount')).toBeNull()
  expect(screen.queryByText('profile.devices.title')).toBeNull()
  expect(screen.queryByText('profile.myGiftLists')).toBeNull()
  expect(fetchMyGiftLists).not.toHaveBeenCalled()
  expect(fetchMyDevices).not.toHaveBeenCalled()
})

it('on a server too old to say, hides 404ing sections and explains a 404 export', async () => {
  const notFound = Object.assign(new Error('Not Found'), { response: { status: 404 } })
  jest.mocked(fetchMyGiftLists).mockRejectedValue(notFound)
  jest.mocked(fetchMyDevices).mockRejectedValue(notFound)
  jest.mocked(getMyExportRequest).mockRejectedValue(notFound)
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {})
  await renderProfile({ version: '0.5.0' })

  // Export and delete stay offered: the server might have them.
  expect(await screen.findByText('profile.exportButton')).toBeTruthy()
  expect(screen.getByText('profile.deleteAccount')).toBeTruthy()
  await waitFor(() => expect(fetchMyDevices).toHaveBeenCalledTimes(1))
  await waitFor(() => expect(fetchMyGiftLists).toHaveBeenCalledTimes(1))
  expect(screen.queryByText('profile.devices.title')).toBeNull()
  expect(screen.queryByText('profile.myGiftLists')).toBeNull()

  await fireEvent.press(screen.getByText('profile.exportButton'))
  await waitFor(() => expect(alert).toHaveBeenCalledWith('common.error', 'profile.featureUnavailable'))
  alert.mockRestore()
})
