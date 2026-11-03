import { act, renderHook } from '@testing-library/react-native'
import type { VideoPlayer } from 'expo-video'
import { useExclusiveVideo } from '../useExclusiveVideo'

function makePlayer() {
  let notify: (event: { isPlaying: boolean }) => void = () => {}
  const remove = jest.fn()
  const player = {
    pause: jest.fn(),
    addListener: jest.fn((_event: string, callback: typeof notify) => {
      notify = callback
      return { remove }
    }),
  }
  return {
    player: player as unknown as VideoPlayer,
    pause: player.pause,
    remove,
    playing: (isPlaying: boolean) => notify({ isPlaying }),
  }
}

it('stops the previous player and its Live Photo state when another starts', async () => {
  const first = makePlayer()
  const second = makePlayer()
  const interrupted = jest.fn()
  const hook = await renderHook(() => {
    useExclusiveVideo(first.player, interrupted)
    useExclusiveVideo(second.player)
  })
  await act(async () => {
    second.playing(true)
  })
  expect(first.pause).toHaveBeenCalledTimes(1)
  expect(interrupted).toHaveBeenCalledTimes(1)
  expect(second.pause).not.toHaveBeenCalled()
  await act(async () => {
    second.playing(false)
  })
  expect(first.pause).toHaveBeenCalledTimes(1)
  await hook.unmount()
  expect(first.remove).toHaveBeenCalledTimes(1)
  expect(second.remove).toHaveBeenCalledTimes(1)
})

it('removes unmounted players from playback coordination', async () => {
  const first = makePlayer()
  const second = makePlayer()
  const firstHook = await renderHook(() => useExclusiveVideo(first.player))
  const secondHook = await renderHook(() => useExclusiveVideo(second.player))
  await firstHook.unmount()
  await act(async () => {
    second.playing(true)
  })
  expect(first.pause).not.toHaveBeenCalled()
  await secondHook.unmount()
})
