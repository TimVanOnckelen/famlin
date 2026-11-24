import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createChatConversation, fetchChatPeople } from '@famlin/api-client'

const mockNavigate = jest.fn()
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
}))
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('@/components/Icon', () => ({ Icon: () => null }))
jest.mock('@/components/Avatar', () => ({ Avatar: () => null }))
jest.mock('@/components/ScreenHeader', () => ({ ScreenHeader: () => null }))
jest.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: any) => selector({ user: { id: 'me' } }),
}))
jest.mock('@famlin/api-client', () => ({
  ...jest.requireActual('@famlin/api-client'),
  fetchChatPeople: jest.fn(),
  createChatConversation: jest.fn(),
}))

import { DmMemberPickerScreen } from '../DmMemberPickerScreen'

function renderScreen() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { gcTime: Infinity } },
  })
  return render(
    <QueryClientProvider client={client}>
      <DmMemberPickerScreen />
    </QueryClientProvider>
  )
}

beforeEach(() => jest.clearAllMocks())

it('searches the authoritative people list, deduplicates identities, excludes self, and reuses a conversation', async () => {
  jest.mocked(fetchChatPeople).mockResolvedValue({
    items: [
      { id: 'me', name: 'Gabriel', avatarUrl: null },
      { id: 'ana', name: 'Ana', avatarUrl: null },
      { id: 'ana', name: 'Ana duplicate', avatarUrl: null },
      { id: 'bob', name: 'Bob', avatarUrl: null },
    ],
  })
  jest.mocked(createChatConversation).mockResolvedValue({ id: 'stable-private' } as never)
  await renderScreen()

  const input = await screen.findByLabelText('chat.searchPeople')
  fireEvent.changeText(input, 'an')
  await waitFor(() => expect(screen.queryByText('Bob')).toBeNull())
  expect(screen.getByText('Ana')).toBeTruthy()
  expect(screen.queryByText('Gabriel')).toBeNull()
  expect(screen.queryByText('Bob')).toBeNull()

  fireEvent.press(screen.getByText('Ana'))
  await waitFor(() => expect(createChatConversation).toHaveBeenCalledWith({ kind: 'PRIVATE', participantIds: ['ana'] }))
  expect(mockNavigate).toHaveBeenCalledWith('DirectMessage', { conversationId: 'stable-private' })
})
