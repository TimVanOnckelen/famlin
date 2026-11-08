import React from 'react'
import { render, screen, waitFor } from '@testing-library/react-native'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fetchServerInfo, fetchStoryHighlights, fetchStoryTray } from '@famlin/api-client'

import { StoryTray } from '@/components/StoryTray'
import { resetServerFeatureCache } from '@/utils/serverFeatures'

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

// `serverInfo` primes the cache, as the feed has normally loaded it already;
// without it server-info is fetched (and 'unknown' until it lands).
function renderTray(serverInfo?: object) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  if (serverInfo) client.setQueryData(['server-info', 'https://family.example'], serverInfo)
  return render(
    <QueryClientProvider client={client}>
      <StoryTray groupIds={['g1']} enabled />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  resetServerFeatureCache()
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

it('renders nothing and never calls /api/stories on a server that says it lacks stories', async () => {
  await renderTray({ version: '0.9.0', features: ['circles'] })
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(screen.queryByText('stories.yourStory')).toBeNull()
  expect(fetchStoryTray).not.toHaveBeenCalled()
  expect(fetchStoryHighlights).not.toHaveBeenCalled()
})

it('tries on a server too old to say, and hides silently on a 404 without retrying', async () => {
  jest.mocked(fetchServerInfo).mockResolvedValue({ version: '0.7.0' } as never)
  const notFound = Object.assign(new Error('Not Found'), { response: { status: 404 } })
  jest.mocked(fetchStoryTray).mockRejectedValue(notFound)
  jest.mocked(fetchStoryHighlights).mockRejectedValue(notFound)
  await renderTray()
  await waitFor(() => expect(fetchStoryTray).toHaveBeenCalled())
  await waitFor(() => expect(screen.queryByText('stories.yourStory')).toBeNull())
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(fetchStoryTray).toHaveBeenCalledTimes(1)
})

it('remembers the 404: a later mount on the same server asks nothing', async () => {
  jest.mocked(fetchServerInfo).mockResolvedValue({ version: '0.7.0' } as never)
  const notFound = Object.assign(new Error('Not Found'), { response: { status: 404 } })
  jest.mocked(fetchStoryTray).mockRejectedValue(notFound)
  jest.mocked(fetchStoryHighlights).mockRejectedValue(notFound)
  await renderTray()
  await waitFor(() => expect(fetchStoryTray).toHaveBeenCalledTimes(1))
  await waitFor(() => expect(fetchStoryHighlights).toHaveBeenCalledTimes(1))

  // Another mount with a fresh query cache, so nothing is reused from the
  // first one's errored queries.
  await renderTray({ version: '0.7.0' })
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(screen.queryByText('stories.yourStory')).toBeNull()
  expect(fetchStoryTray).toHaveBeenCalledTimes(1)
  expect(fetchStoryHighlights).toHaveBeenCalledTimes(1)
})

it('shows the tray on a 0.8.7 server that has stories but predates the features list', async () => {
  jest.mocked(fetchServerInfo).mockResolvedValue({ version: '0.8.7' } as never)
  await renderTray()
  expect(await screen.findByText('stories.yourStory')).toBeTruthy()
  expect(fetchStoryTray).toHaveBeenCalledWith(['g1'])
})

it('does not wait for server-info: unknown means try', async () => {
  jest.mocked(fetchServerInfo).mockReturnValue(new Promise(() => {}))
  await renderTray()
  expect(await screen.findByText('stories.yourStory')).toBeTruthy()
  expect(fetchStoryTray).toHaveBeenCalledWith(['g1'])
})
