import React from 'react'
import { render, waitFor } from '@testing-library/react-native'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useVideoPlayer } from 'expo-video'

const mockPlayer = {
  loop: false,
  play: jest.fn(),
  pause: jest.fn(),
  addListener: jest.fn(() => ({ remove: jest.fn() })),
}
const mockOriginalVideoUrl = 'https://famlin.test/uploads/clip.mp4?token=media-token'

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: jest.fn() }),
  useRoute: () => ({ params: { urls: [mockOriginalVideoUrl], initialIndex: 0 } }),
  useIsFocused: () => true,
}))
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}))
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
jest.mock('@/i18n/utils', () => ({ formatRelativeDate: () => 'now' }))
jest.mock('expo-video', () => ({
  useVideoPlayer: jest.fn(() => mockPlayer),
  VideoView: 'VideoView',
}))
jest.mock('expo-screen-orientation', () => ({
  unlockAsync: jest.fn(),
  lockAsync: jest.fn(),
  OrientationLock: { PORTRAIT_UP: 'PORTRAIT_UP' },
}))
jest.mock('expo-media-library', () => ({
  requestPermissionsAsync: jest.fn(),
  Asset: { create: jest.fn() },
}))
jest.mock('expo-file-system', () => ({
  File: jest.fn(),
  Paths: { cache: '/cache' },
}))
jest.mock('@/components/SwipeToDismiss', () => ({
  SwipeToDismiss: ({ children }: { children: React.ReactNode }) => children,
}))
jest.mock('@/components/Icon', () => ({ Icon: () => null }))
jest.mock('@/components/Avatar', () => ({ Avatar: () => null }))
jest.mock('@/components/ReactionPicker', () => ({ ReactionPicker: () => null }))
jest.mock('@/components/LivePhotoMedia', () => ({ LivePhotoMedia: () => null }))
jest.mock('@/hooks/useExclusiveVideo', () => ({ useExclusiveVideo: jest.fn() }))
jest.mock('@/hooks/useUploadProcessing', () => {
  const React = require('react')
  return {
    UploadProcessingContext: React.createContext(undefined),
    useUploadProcessing: () => ({ pending: false, failed: false, kind: 'video' }),
  }
})
jest.mock('@/hooks/usePostMutations', () => ({
  useReactToPost: () => ({ mutate: jest.fn(), isPending: false }),
  useToggleFavorite: () => ({ mutate: jest.fn(), isPending: false }),
}))
jest.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (state: { user: { id: string } }) => unknown) => selector({ user: { id: 'me' } }),
}))

import { ImageViewerScreen } from '../ImageViewerScreen'

it('plays an authenticated original mp4 opened by the DM attachment navigation', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await render(
    <QueryClientProvider client={client}>
      <ImageViewerScreen />
    </QueryClientProvider>
  )

  await waitFor(() => expect(useVideoPlayer).toHaveBeenCalledWith({ uri: mockOriginalVideoUrl }, expect.any(Function)))
  await waitFor(() => expect(mockPlayer.play).toHaveBeenCalled())
})
