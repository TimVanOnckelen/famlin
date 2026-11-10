import { Share } from 'react-native'
import { fireEvent, render } from '@testing-library/react-native'

import { ScrollDiagnosticsBar } from '../ScrollDiagnosticsBar'
import { isScrollRecording, scrollRecorderListProps } from '@/utils/scrollRecorder'
import { useScrollDiagnosticsStore } from '@/stores/scrollDiagnosticsStore'

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
let mockFeatureSupport = 'supported'
jest.mock('@/hooks/useServerInfo', () => ({
  useServerInfo: () => ({ data: { version: '0.9.0' } }),
  useServerFeatureSupport: () => mockFeatureSupport,
}))
jest.mock('@/components/Icon', () => ({ Icon: () => null }))
const mockSendDiagnosticReport = jest.fn()
jest.mock('@famlin/api-client', () => ({
  sendDiagnosticReport: (...args: unknown[]) => mockSendDiagnosticReport(...args),
}))
// Jest factories load the official native-library mocks synchronously.
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('react-native-worklets', () => require('react-native-worklets/src/mock'))
// See SwipeToDismiss.test.tsx: Reanimated's own mock can't be imported under
// Jest without stubbing this one native call.
jest.mock('react-native-reanimated/src/css/native/proxy', () => ({
  ...jest.requireActual('react-native-reanimated/src/css/native/proxy'),
  setCSSEventHandler: () => {},
}))
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'))

const posts = [
  { id: 'p1', type: 'UPDATE', uploadedAssetUrls: ['/uploads/a.jpg', '/uploads/b.jpg'] },
  { id: 'p2', type: 'POLL', uploadedAssetUrls: [] },
] as any

beforeEach(() => {
  mockFeatureSupport = 'supported'
  mockSendDiagnosticReport.mockReset().mockResolvedValue(undefined)
})

async function recordOnce(screen: Awaited<ReturnType<typeof render>>) {
  await fireEvent.press(screen.getByText('scrollDiagnostics.start'))
  scrollRecorderListProps.onViewableItemsChanged({ viewableItems: [{ key: 'p1' }] as any })
  await fireEvent.press(screen.getByText('scrollDiagnostics.stop'))
}

it('records a scroll and shares the report', async () => {
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as any)
  const screen = await render(<ScrollDiagnosticsBar posts={posts} />)
  expect(screen.getByText('scrollDiagnostics.hint')).toBeTruthy()

  await fireEvent.press(screen.getByText('scrollDiagnostics.start'))
  expect(isScrollRecording()).toBe(true)
  expect(screen.getByText('scrollDiagnostics.recording')).toBeTruthy()

  scrollRecorderListProps.onViewableItemsChanged({ viewableItems: [{ key: 'p1' }] as any })
  await fireEvent.press(screen.getByText('scrollDiagnostics.stop'))
  expect(isScrollRecording()).toBe(false)
  expect(screen.getByText('scrollDiagnostics.uiResult')).toBeTruthy()

  await fireEvent.press(screen.getByText('scrollDiagnostics.share'))
  const message = share.mock.calls[0][0] as { message: string }
  expect(message.message).toContain('Server: 0.9.0')
  // Only the post that was actually on screen is described.
  expect(message.message).toContain('Posts seen: 1 (UPDATE 1)')
})

it('stops the recorder when the feed goes away mid-recording', async () => {
  const screen = await render(<ScrollDiagnosticsBar posts={posts} />)
  await fireEvent.press(screen.getByText('scrollDiagnostics.start'))
  await screen.unmount()
  expect(isScrollRecording()).toBe(false)
})

it('sends the report to the server admin once', async () => {
  const screen = await render(<ScrollDiagnosticsBar posts={posts} />)
  await recordOnce(screen)

  await fireEvent.press(screen.getByText('scrollDiagnostics.sendToAdmin'))
  expect(mockSendDiagnosticReport).toHaveBeenCalledTimes(1)
  const sent = mockSendDiagnosticReport.mock.calls[0][0]
  expect(sent).toMatchObject({ kind: 'feed_scroll', data: { server: '0.9.0' } })
  expect(sent.text).toContain('Posts seen: 1 (UPDATE 1)')
  expect(await screen.findByText('scrollDiagnostics.sent')).toBeTruthy()

  await fireEvent.press(screen.getByText('scrollDiagnostics.sent'))
  expect(mockSendDiagnosticReport).toHaveBeenCalledTimes(1)
})

it('lets the member retry after a failed send', async () => {
  mockSendDiagnosticReport.mockRejectedValueOnce(new Error('offline'))
  const screen = await render(<ScrollDiagnosticsBar posts={posts} />)
  await recordOnce(screen)

  await fireEvent.press(screen.getByText('scrollDiagnostics.sendToAdmin'))
  expect(await screen.findByText('scrollDiagnostics.sendFailed')).toBeTruthy()
  await fireEvent.press(screen.getByText('scrollDiagnostics.sendFailed'))
  expect(await screen.findByText('scrollDiagnostics.sent')).toBeTruthy()
})

it('offers only sharing on a server without diagnostic reports', async () => {
  mockFeatureSupport = 'unsupported'
  const screen = await render(<ScrollDiagnosticsBar posts={posts} />)
  await recordOnce(screen)
  expect(screen.queryByText('scrollDiagnostics.sendToAdmin')).toBeNull()
  expect(screen.getByText('scrollDiagnostics.share')).toBeTruthy()
})

it('switches the diagnostics off with the close button', async () => {
  useScrollDiagnosticsStore.getState().setEnabled(true)
  const screen = await render(<ScrollDiagnosticsBar posts={posts} />)
  await fireEvent.press(screen.getByLabelText('scrollDiagnostics.close'))
  expect(useScrollDiagnosticsStore.getState().enabled).toBe(false)
})
