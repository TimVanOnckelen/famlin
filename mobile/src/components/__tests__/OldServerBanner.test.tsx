import React from 'react'
import { Linking } from 'react-native'
import { render, fireEvent, waitFor, screen } from '@testing-library/react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'

import { OldServerBanner, SERVER_VERSIONS_DOCS_URL } from '@/components/OldServerBanner'
import { useAuthStore } from '@/stores/authStore'

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) => (options ? `${key} ${JSON.stringify(options)}` : key),
  }),
}))

jest.mock('@/components/Icon', () => ({ Icon: () => null }))

let mockServerVersion: string | undefined
jest.mock('@/hooks/useServerInfo', () => ({
  useServerInfo: () => ({ data: mockServerVersion === undefined ? undefined : { version: mockServerVersion } }),
}))

jest.mock('@famlin/api-client', () => ({
  ...jest.requireActual('@famlin/api-client'),
  getCurrentServerUrl: () => 'https://family.example',
}))

function setUser(isAdmin: boolean) {
  useAuthStore.setState({ user: { id: 'u1', name: 'Ann', isAdmin } as never })
}

describe('OldServerBanner', () => {
  beforeEach(async () => {
    await AsyncStorage.clear()
    setUser(false)
  })

  it('shows a member the ask-your-admin text below the minimum', async () => {
    mockServerVersion = '0.4.0'
    await render(<OldServerBanner />)
    expect(await screen.findByText('serverVersion.memberMessage')).toBeTruthy()
    expect(screen.queryByText('serverVersion.howToUpdate')).toBeNull()
  })

  it('shows an admin the update text with a docs link', async () => {
    setUser(true)
    mockServerVersion = '0.4.0'
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined)
    await render(<OldServerBanner />)
    expect(await screen.findByText(/serverVersion\.adminMessage .*"version":"0\.5\.0"/)).toBeTruthy()
    await fireEvent.press(screen.getByText('serverVersion.howToUpdate'))
    expect(openURL).toHaveBeenCalledWith(SERVER_VERSIONS_DOCS_URL)
  })

  it('renders nothing at or above the minimum, or without a version', async () => {
    for (const v of ['0.5.0', '0.9.1', undefined, 'nightly']) {
      mockServerVersion = v
      const { unmount } = await render(<OldServerBanner />)
      await waitFor(() => expect(screen.queryByTestId('old-server-banner')).toBeNull())
      await unmount()
    }
  })

  it('stays dismissed for this version and returns for a new one', async () => {
    mockServerVersion = '0.4.0'
    const first = await render(<OldServerBanner />)
    await screen.findByTestId('old-server-banner')
    await fireEvent.press(screen.getByLabelText('serverVersion.dismiss'))
    expect(screen.queryByTestId('old-server-banner')).toBeNull()
    await first.unmount()

    const again = await render(<OldServerBanner />)
    await waitFor(() => expect(AsyncStorage.getItem).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByTestId('old-server-banner')).toBeNull())
    await again.unmount()

    mockServerVersion = '0.4.1'
    await render(<OldServerBanner />)
    expect(await screen.findByTestId('old-server-banner')).toBeTruthy()
  })
})
