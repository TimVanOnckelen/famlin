import React from 'react'
import { Alert, Linking, Share } from 'react-native'
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createCalendarFeed, fetchCalendarFeed, revokeCalendarFeed } from '@famlin/api-client'

import { CalendarFeedSection } from '@/components/CalendarFeedSection'
import { resetServerFeatureCache } from '@/utils/serverFeatures'

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}))
jest.mock('@/components/Icon', () => ({ Icon: () => null }))
jest.mock('@famlin/api-client', () => ({
  ...jest.requireActual('@famlin/api-client'),
  getCurrentServerUrl: () => 'https://family.example',
  fetchServerInfo: jest.fn(),
  fetchCalendarFeed: jest.fn(),
  createCalendarFeed: jest.fn(),
  revokeCalendarFeed: jest.fn(),
}))

const CREATED = {
  url: 'https://family.example/api/calendar/secret/famlin.ics',
  webcalUrl: 'webcal://family.example/api/calendar/secret/famlin.ics',
  createdAt: '2026-11-20T10:00:00.000Z',
}

function renderSection(features: string[] = ['calendarFeed']) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  client.setQueryData(['server-info', 'https://family.example'], { version: '0.9.0', features })
  return render(
    <QueryClientProvider client={client}>
      <CalendarFeedSection />
    </QueryClientProvider>
  )
}

// Presses the button of the confirmation Alert labelled `label`.
function confirmAlert(alert: jest.SpyInstance, label: string) {
  const buttons = alert.mock.calls.at(-1)?.[2] as { text: string; onPress?: () => void }[]
  buttons.find((b) => b.text === label)?.onPress?.()
}

let alert: jest.SpyInstance
beforeEach(() => {
  resetServerFeatureCache()
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {})
  jest.mocked(fetchCalendarFeed).mockResolvedValue({ enabled: false, createdAt: null, lastUsedAt: null })
  jest.mocked(createCalendarFeed).mockResolvedValue(CREATED)
  jest.mocked(revokeCalendarFeed).mockResolvedValue()
})
afterEach(() => {
  alert.mockRestore()
  jest.clearAllMocks()
})

it('is hidden, and never asks for the feed, on a server without calendarFeed', async () => {
  await renderSection(['stories'])
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(screen.queryByText('profile.calendarFeed.title')).toBeNull()
  expect(fetchCalendarFeed).not.toHaveBeenCalled()
})

it('creates a link, shows the URL once and opens webcal:// to add it', async () => {
  const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined)
  await renderSection()
  await fireEvent.press(await screen.findByText('profile.calendarFeed.create'))

  expect(await screen.findByText(CREATED.url)).toBeTruthy()
  expect(screen.getByText('profile.calendarFeed.shownOnce')).toBeTruthy()
  expect(createCalendarFeed).toHaveBeenCalledTimes(1)

  await fireEvent.press(screen.getByText('profile.calendarFeed.addToCalendar'))
  expect(openURL).toHaveBeenCalledWith(CREATED.webcalUrl)
  openURL.mockRestore()
})

it('explains how to copy the link when no app opens webcal://', async () => {
  const openURL = jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no handler'))
  await renderSection()
  await fireEvent.press(await screen.findByText('profile.calendarFeed.create'))
  await fireEvent.press(await screen.findByText('profile.calendarFeed.addToCalendar'))
  await waitFor(() =>
    expect(alert).toHaveBeenCalledWith('profile.calendarFeed.openFailedTitle', 'profile.calendarFeed.openFailedMessage')
  )
  openURL.mockRestore()
})

it('shares the URL so it can be copied', async () => {
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction, activityType: undefined })
  await renderSection()
  await fireEvent.press(await screen.findByText('profile.calendarFeed.create'))
  await fireEvent.press(await screen.findByText('profile.calendarFeed.copy'))
  expect(share).toHaveBeenCalledWith({ message: CREATED.url })
  share.mockRestore()
})

describe('with an existing feed', () => {
  beforeEach(() => {
    jest.mocked(fetchCalendarFeed).mockResolvedValue({
      enabled: true,
      createdAt: '2026-11-01T10:00:00.000Z',
      lastUsedAt: null,
    })
  })

  it('regenerates only after confirming, then shows the new URL', async () => {
    await renderSection()
    expect(await screen.findByText('profile.calendarFeed.neverUsed')).toBeTruthy()
    expect(screen.queryByText(CREATED.url)).toBeNull()

    await fireEvent.press(screen.getByText('profile.calendarFeed.regenerate'))
    expect(alert).toHaveBeenCalledWith(
      'profile.calendarFeed.regenerateTitle',
      'profile.calendarFeed.regenerateMessage',
      expect.any(Array)
    )
    expect(createCalendarFeed).not.toHaveBeenCalled()

    confirmAlert(alert, 'profile.calendarFeed.regenerate')
    expect(await screen.findByText(CREATED.url)).toBeTruthy()
    expect(createCalendarFeed).toHaveBeenCalledTimes(1)
  })

  it('turns the feed off only after confirming', async () => {
    await renderSection()
    await fireEvent.press(await screen.findByText('profile.calendarFeed.revoke'))
    expect(alert).toHaveBeenCalledWith(
      'profile.calendarFeed.revokeTitle',
      'profile.calendarFeed.revokeMessage',
      expect.any(Array)
    )
    expect(revokeCalendarFeed).not.toHaveBeenCalled()

    confirmAlert(alert, 'profile.calendarFeed.revoke')
    expect(await screen.findByText('profile.calendarFeed.create')).toBeTruthy()
    expect(revokeCalendarFeed).toHaveBeenCalledTimes(1)
  })
})

it('keeps regenerate and turn off reachable right after creating a link', async () => {
  await renderSection()
  await fireEvent.press(await screen.findByText('profile.calendarFeed.create'))
  expect(await screen.findByText(CREATED.url)).toBeTruthy()
  expect(screen.getByText('profile.calendarFeed.regenerate')).toBeTruthy()

  await fireEvent.press(screen.getByText('profile.calendarFeed.revoke'))
  confirmAlert(alert, 'profile.calendarFeed.revoke')
  await waitFor(() => expect(revokeCalendarFeed).toHaveBeenCalled())
  expect(await screen.findByText('profile.calendarFeed.create')).toBeTruthy()
  expect(screen.queryByText(CREATED.url)).toBeNull()
})

it('offers a retry, never a silent create, when the status fails to load', async () => {
  jest.mocked(fetchCalendarFeed).mockRejectedValueOnce(new Error('offline'))
  await renderSection()
  expect(await screen.findByText('profile.calendarFeed.loadFailed')).toBeTruthy()
  expect(screen.queryByText('profile.calendarFeed.create')).toBeNull()

  jest.mocked(fetchCalendarFeed).mockResolvedValue({ enabled: true, createdAt: CREATED.createdAt, lastUsedAt: null })
  await fireEvent.press(screen.getByText('common.tryAgain'))
  expect(await screen.findByText('profile.calendarFeed.regenerate')).toBeTruthy()
  expect(createCalendarFeed).not.toHaveBeenCalled()
})
