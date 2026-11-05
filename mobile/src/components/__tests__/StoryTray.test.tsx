import React from 'react'
import { render, screen, waitFor } from '@testing-library/react-native'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fetchServerInfo, fetchStoryHighlights, fetchStoryTray } from '@famlin/api-client'

import { StoryTray } from '@/components/StoryTray'

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }) }))
jest.mock('@/components/Icon', () => ({ Icon: () => null }))
jest.mock('@/components/Avatar', () => ({ Avatar: () => null }))

jest.mock('@famlin/api-client', () => ({
  ...jest.requireActual('@famlin/api-client'),
  getCurrentServerUrl: () => 'https://family.example',
  fetchServerInfo: jest.fn(),
  fetchStoryTray: jest.fn(),
  fetchStoryHighlights: jest.fn(),
}))

function renderTray() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  return render(
    <QueryClientProvider client={client}>
      <StoryTray groupIds={['g1']} enabled />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  jest.mocked(fetchStoryTray).mockResolvedValue({ authors: [] } as never)
  jest.mocked(fetchStoryHighlights).mockResolvedValue({ items: [], nextCursor: null } as never)
})
afterEach(() => jest.clearAllMocks())

it('shows the tray and fetches stories on a server with stories', async () => {
  jest.mocked(fetchServerInfo).mockResolvedValue({ version: '0.9.0', features: ['stories'] } as never)
  await renderTray()
  expect(await screen.findByText('stories.yourStory')).toBeTruthy()
  await waitFor(() => expect(fetchStoryTray).toHaveBeenCalledWith(['g1']))
})

it('renders nothing and never calls /api/stories on a server without stories', async () => {
  jest.mocked(fetchServerInfo).mockResolvedValue({ version: '0.7.0' } as never)
  await renderTray()
  await waitFor(() => expect(fetchServerInfo).toHaveBeenCalled())
  // Let the server-info result settle before asserting nothing followed it.
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(screen.queryByText('stories.yourStory')).toBeNull()
  expect(fetchStoryTray).not.toHaveBeenCalled()
  expect(fetchStoryHighlights).not.toHaveBeenCalled()
})

it('stays hidden while server-info is still loading', async () => {
  jest.mocked(fetchServerInfo).mockReturnValue(new Promise(() => {}))
  await renderTray()
  expect(screen.queryByText('stories.yourStory')).toBeNull()
  expect(fetchStoryTray).not.toHaveBeenCalled()
})
