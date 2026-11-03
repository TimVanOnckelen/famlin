import { useEffect } from 'react'
import { AppState } from 'react-native'
import { render, fireEvent } from '@testing-library/react-native'
import { useVideoPlayer } from 'expo-video'
import { LivePhotoMedia } from '../LivePhotoMedia'

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }))
jest.mock('expo-image', () => ({ Image: 'Image' }))
jest.mock('expo-video', () => ({ useVideoPlayer: jest.fn(), VideoView: 'VideoView' }))
jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native')
  const React = jest.requireActual('react')
  const mocked = Object.create(actual)
  Object.defineProperty(mocked, 'View', {
    value: React.forwardRef(function MockView(props: object, ref: unknown) {
      React.useImperativeHandle(ref, () => ({
        measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) =>
          callback(0, 0, 200, 200),
      }))
      return React.createElement(actual.View, props)
    }),
  })
  return mocked
})

it('stops by releasing the player without calling pause after release', async () => {
  const previousAppState = AppState.currentState
  AppState.currentState = 'active'
  let released = false
  const player = {
    play: jest.fn(),
    pause: jest.fn(() => {
      if (released) throw new Error('Cannot use shared object that was already released')
    }),
    addListener: jest.fn(() => ({ remove: jest.fn() })),
  }
  // Match Expo's lifecycle: its release effect runs before consumer effects.
  jest.mocked(useVideoPlayer).mockImplementation(function useMockVideoPlayer() {
    useEffect(
      () => () => {
        released = true
      },
      []
    )
    return player as unknown as ReturnType<typeof useVideoPlayer>
  })
  const screen = await render(<LivePhotoMedia imageUrl="/uploads/photo.jpg" videoUrl="/uploads/motion.mp4" />)
  expect(useVideoPlayer).not.toHaveBeenCalled()
  await fireEvent.press(screen.getByRole('button', { name: 'media.playLivePhoto' }))
  expect(player.play).toHaveBeenCalledTimes(1)
  await fireEvent.press(screen.getByRole('button', { name: 'media.pauseLivePhoto' }))
  expect(released).toBe(true)
  expect(player.pause).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'media.playLivePhoto' })).toBeTruthy()
  await screen.unmount()
  AppState.currentState = previousAppState
})
