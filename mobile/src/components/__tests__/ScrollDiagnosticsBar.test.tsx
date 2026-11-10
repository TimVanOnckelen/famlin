import { Share } from 'react-native'
import { fireEvent, render } from '@testing-library/react-native'

import { ScrollDiagnosticsBar } from '../ScrollDiagnosticsBar'
import { isScrollRecording, scrollRecorderListProps } from '@/utils/scrollRecorder'

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('@/hooks/useServerInfo', () => ({ useServerInfo: () => ({ data: { version: '0.9.0' } }) }))
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
