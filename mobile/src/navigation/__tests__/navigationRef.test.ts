jest.mock('@react-navigation/native', () => ({
  createNavigationContainerRef: () => {
    const listeners: Record<string, () => void> = {}
    const ref = {
      isReady: jest.fn(() => true),
      getRootState: jest.fn(() => ({ routeNames: ['Login'] })),
      navigate: jest.fn(),
      addListener: jest.fn((event: string, listener: () => void) => {
        listeners[event] = listener
        return jest.fn()
      }),
      listeners,
    }
    ;(globalThis as any).__navigationTestRef = ref
    return ref
  },
}))

import { navigateWhenReady } from '../navigationRef'

it('defers a conversation target until authenticated routes replace Login', () => {
  const ref = (globalThis as any).__navigationTestRef
  navigateWhenReady('DirectMessage', { conversationId: 'c1' })
  expect(ref.navigate).not.toHaveBeenCalled()

  ref.getRootState.mockReturnValue({ routeNames: ['Main', 'DirectMessage'] })
  ref.listeners.state()

  expect(ref.navigate).toHaveBeenCalledWith('DirectMessage', { conversationId: 'c1' })
})
