import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  createChatConversation,
  deleteChatMessage,
  fetchChatConversationMessages,
  fetchChatConversations,
  fetchChatMessages,
  fetchChatPeople,
  fetchGroups,
  fetchServerInfo,
  fetchGroupMembers,
  markChatRead,
  markChatConversationRead,
  sendChatConversationMessage,
  sendChatMessage,
  uploadFilesInSession,
} from '@famlin/api-client'
import { useLocation, useNavigate } from 'react-router'
import { ChatPage } from '@/pages/ChatPage'
import { makeUser, renderWithQueryClient } from '@/test/fixtures'

vi.mock('@famlin/api-client', async (original) => ({
  ...(await original<typeof import('@famlin/api-client')>()),
  fetchChatConversationMessages: vi.fn(),
  fetchChatConversations: vi.fn(),
  createChatConversation: vi.fn(),
  deleteChatMessage: vi.fn(),
  fetchChatMessages: vi.fn(),
  fetchChatPeople: vi.fn(),
  fetchGroupMembers: vi.fn(),
  fetchChatUnreadCounts: vi.fn().mockResolvedValue({}),
  fetchGroups: vi.fn(),
  fetchServerInfo: vi.fn(),
  markChatConversationRead: vi.fn(),
  markChatRead: vi.fn(),
  sendChatConversationMessage: vi.fn(),
  sendChatMessage: vi.fn(),
  uploadFilesInSession: vi.fn(),
  fetchUnreadNotificationCount: vi.fn().mockResolvedValue(0),
}))

function renderPage(route = '/chat') {
  return renderWithQueryClient(
    <>
      <ChatPage
        user={makeUser()}
        onBack={vi.fn()}
        onOpenPhotos={vi.fn()}
        onOpenProfile={vi.fn()}
        onOpenFavorites={vi.fn()}
        onOpenNotifications={vi.fn()}
        onLogout={vi.fn()}
      />
      <LocationProbe />
    </>,
    { route }
  )
}

function LocationProbe() {
  const navigate = useNavigate()
  return (
    <div>
      <output data-testid="location">{useLocation().pathname + useLocation().search}</output>
      <button type="button" onClick={() => navigate(-1)}>
        Browser back
      </button>
    </div>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(fetchServerInfo).mockResolvedValue({ version: '1.0.0', features: ['directMessages'] })
  vi.mocked(fetchGroups).mockResolvedValue([
    {
      id: 'group-1',
      name: 'De Vries family',
      createdAt: '2026-01-01T00:00:00Z',
      chitchatEnabled: true,
    },
  ])
  vi.mocked(fetchChatPeople).mockResolvedValue({ items: [] })
  vi.mocked(fetchGroupMembers).mockResolvedValue([])
  vi.mocked(fetchChatMessages).mockResolvedValue({ items: [], nextCursor: null })
  vi.mocked(markChatRead).mockResolvedValue(undefined)
  vi.mocked(createChatConversation).mockResolvedValue({
    id: 'private-2',
    kind: 'PRIVATE',
    participants: [
      { id: 'user-1', name: 'Grandpa John', avatarUrl: null },
      { id: 'user-3', name: 'Emma', avatarUrl: null },
    ],
    lastMessage: null,
    unreadCount: 0,
    updatedAt: '2026-11-23T11:00:00Z',
  })
  vi.mocked(fetchChatConversationMessages).mockResolvedValue({ items: [], nextCursor: null })
  vi.mocked(markChatConversationRead).mockResolvedValue(undefined)
  vi.mocked(deleteChatMessage).mockResolvedValue(undefined)
  vi.mocked(sendChatConversationMessage).mockResolvedValue({
    id: 'sent-message',
    conversationId: 'private-1',
    groupId: null,
    authorId: 'user-1',
    author: { id: 'user-1', name: 'Grandpa John', avatarUrl: null },
    kind: 'USER',
    content: 'Hello Sophie',
    attachmentUrl: null,
    refPostId: null,
    createdAt: '2026-11-23T12:00:00Z',
    editedAt: null,
    encryption: 'none',
    encryptedPayload: null,
  })
  vi.mocked(sendChatMessage).mockResolvedValue({
    id: 'family-reply',
    groupId: 'group-1',
    authorId: 'user-1',
    author: { id: 'user-1', name: 'Grandpa John', avatarUrl: null },
    kind: 'USER',
    content: 'Replying here',
    attachmentUrl: null,
    refPostId: null,
    replyToMessageId: 'family-message',
    replyTo: {
      id: 'family-message',
      authorId: 'user-2',
      authorName: 'Sophie',
      kind: 'USER',
      content: 'Family original',
      attachmentUrl: null,
    },
    createdAt: '2026-11-23T12:00:00Z',
    editedAt: null,
    readBy: [],
  })
  vi.mocked(uploadFilesInSession).mockResolvedValue({
    urls: ['/uploads/11111111-1111-4111-8111-111111111111.jpg'],
    sessionMedia: [],
  })
  vi.spyOn(URL, 'createObjectURL').mockImplementation((file) => `blob:${(file as File).name}`)
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.mocked(fetchChatConversations).mockResolvedValue({
    items: [
      {
        id: 'private-1',
        kind: 'PRIVATE',
        participants: [
          { id: 'user-1', name: 'Grandpa John', avatarUrl: null },
          { id: 'user-2', name: 'Sophie', avatarUrl: '/uploads/sophie.jpg' },
        ],
        lastMessage: {
          id: 'message-1',
          authorId: 'user-2',
          content: 'See you Sunday',
          hasAttachment: false,
          createdAt: '2026-11-23T10:00:00Z',
          encryption: 'none',
        },
        unreadCount: 2,
        updatedAt: '2026-11-23T10:00:00Z',
      },
      {
        id: 'family-1',
        kind: 'FAMILY',
        group: { id: 'group-1', name: 'De Vries family' },
        participants: [{ id: 'user-1', name: 'Grandpa John', avatarUrl: null }],
        lastMessage: null,
        unreadCount: 0,
        updatedAt: '2026-11-22T10:00:00Z',
      },
    ],
  })
})

it('uses the authoritative unified inbox on a capable server', async () => {
  renderPage()

  expect(await screen.findByRole('heading', { name: 'Direct messages' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Family chats' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Sophie/ })).toHaveTextContent('See you Sunday')
  expect(screen.getByRole('button', { name: /De Vries family/ })).toBeInTheDocument()
  await waitFor(() => expect(fetchChatConversations).toHaveBeenCalledOnce())
  expect(fetchChatMessages).not.toHaveBeenCalled()
})

it('opens a selected conversation with browser history and marks only it read', async () => {
  vi.mocked(fetchChatConversationMessages).mockResolvedValue({
    items: [
      {
        id: 'message-1',
        conversationId: 'private-1',
        groupId: null,
        authorId: 'user-2',
        author: { id: 'user-2', name: 'Sophie', avatarUrl: null },
        kind: 'USER',
        content: 'See you Sunday',
        attachmentUrl: null,
        refPostId: null,
        createdAt: '2026-11-23T10:00:00Z',
        editedAt: null,
        encryption: 'none',
        encryptedPayload: null,
      },
    ],
    nextCursor: null,
  })
  renderPage()

  await userEvent.click(await screen.findByRole('button', { name: /Sophie/ }))
  expect(screen.getByTestId('location')).toHaveTextContent('/chat?conversation=private-1')
  expect(await screen.findByRole('heading', { name: 'Sophie' })).toBeInTheDocument()
  expect(screen.getAllByText('See you Sunday')).not.toHaveLength(0)
  await waitFor(() => expect(markChatConversationRead).toHaveBeenCalledWith('private-1'))
  expect(markChatConversationRead).toHaveBeenCalledTimes(1)
  await waitFor(() => expect(screen.queryByLabelText('2 unread messages')).not.toBeInTheDocument())
  expect(screen.getByRole('button', { name: 'Back to inbox' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Delete message' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Back to inbox' }))
  expect(screen.getByTestId('location')).toHaveTextContent('/chat')
  expect(screen.getByTestId('location')).not.toHaveTextContent('conversation=')
  await userEvent.click(screen.getByRole('button', { name: 'Browser back' }))
  expect(screen.getByTestId('location')).toHaveTextContent('/chat')
  expect(screen.getByTestId('location')).not.toHaveTextContent('conversation=')
})

it('focuses a searchable recipient picker and delegates conversation reuse to the server', async () => {
  vi.mocked(fetchChatPeople).mockResolvedValue({
    items: [
      { id: 'user-2', name: 'Sophie', avatarUrl: null },
      { id: 'user-3', name: 'Emma', avatarUrl: null },
    ],
  })
  renderPage()
  await userEvent.click(await screen.findByRole('button', { name: 'New message' }))

  const dialog = screen.getByRole('dialog', { name: 'New message' })
  const search = screen.getByRole('searchbox', { name: 'Search people' })
  expect(search).toHaveFocus()
  await userEvent.type(search, 'Emma')
  expect(within(dialog).queryByRole('button', { name: /Sophie/ })).not.toBeInTheDocument()
  await userEvent.click(within(dialog).getByRole('button', { name: /Emma/ }))

  await waitFor(() =>
    expect(createChatConversation).toHaveBeenCalledWith({
      kind: 'PRIVATE',
      participantIds: ['user-3'],
    })
  )
  expect(dialog).not.toBeInTheDocument()
  await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/chat?conversation=private-2'))
})

it('sends text through the active conversation and clears the composer', async () => {
  renderPage()
  await userEvent.click(await screen.findByRole('button', { name: /Sophie/ }))
  const input = await screen.findByRole('textbox', { name: 'Message' })
  await userEvent.type(input, 'Hello Sophie')
  await userEvent.click(screen.getByRole('button', { name: 'Send' }))

  await waitFor(() =>
    expect(sendChatConversationMessage).toHaveBeenCalledWith('private-1', {
      content: 'Hello Sophie',
      attachmentUrl: undefined,
    })
  )
  expect(input).toHaveValue('')
  expect(screen.getByText('Hello Sophie')).toBeInTheDocument()
})

it('replies to a private message through the conversation endpoint and quotes it locally', async () => {
  vi.mocked(sendChatConversationMessage).mockImplementation(async (conversationId, body) => ({
    id: 'private-reply',
    conversationId,
    groupId: null,
    authorId: 'user-1',
    author: { id: 'user-1', name: 'Grandpa John', avatarUrl: null },
    kind: 'USER',
    content: body.content ?? null,
    attachmentUrl: body.attachmentUrl ?? null,
    refPostId: null,
    createdAt: '2026-11-23T12:00:00Z',
    editedAt: null,
    encryption: 'none',
    encryptedPayload: null,
  }))
  vi.mocked(fetchChatConversationMessages).mockResolvedValue({
    items: [
      {
        id: 'private-message',
        conversationId: 'private-1',
        groupId: null,
        authorId: 'user-2',
        author: { id: 'user-2', name: 'Sophie', avatarUrl: null },
        kind: 'USER',
        content: 'Original private message',
        attachmentUrl: null,
        refPostId: null,
        createdAt: '2026-11-23T10:00:00Z',
        editedAt: null,
        encryption: 'none',
        encryptedPayload: null,
      },
    ],
    nextCursor: null,
  })
  renderPage()
  await userEvent.click(await screen.findByRole('button', { name: /Sophie/ }))
  await userEvent.click(await screen.findByRole('button', { name: 'Reply to Sophie' }))

  expect(screen.getByText('Replying to Sophie')).toBeInTheDocument()
  await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), 'Private reply')
  await userEvent.click(screen.getByRole('button', { name: 'Send' }))

  await waitFor(() =>
    expect(sendChatConversationMessage).toHaveBeenCalledWith('private-1', {
      content: 'Private reply',
      attachmentUrl: undefined,
      replyToMessageId: 'private-message',
    })
  )
  expect(sendChatMessage).not.toHaveBeenCalled()
  expect(screen.queryByText('Replying to Sophie')).not.toBeInTheDocument()
  expect(screen.getAllByText('Original private message')).toHaveLength(2)
  expect(screen.getByText('Private reply')).toBeInTheDocument()
})

it.each([
  ['media only', '', undefined],
  ['mixed text and media', 'Here is the photo', 'Here is the photo'],
])('sends %s after uploading the selected media', async (_label, text, expectedContent) => {
  const file = new File(['photo'], 'garden.jpg', { type: 'image/jpeg' })
  vi.mocked(sendChatConversationMessage).mockImplementation(async (conversationId, body) => ({
    id: 'attachment-message',
    conversationId,
    groupId: null,
    authorId: 'user-1',
    author: { id: 'user-1', name: 'Grandpa John', avatarUrl: null },
    kind: 'USER',
    content: body.content ?? null,
    attachmentUrl: body.attachmentUrl ?? null,
    refPostId: null,
    createdAt: '2026-11-23T12:00:00Z',
    editedAt: null,
    encryption: 'none',
    encryptedPayload: null,
  }))
  const { container } = renderPage()
  await userEvent.click(await screen.findByRole('button', { name: /Sophie/ }))
  const input = screen.getByRole('textbox', { name: 'Message' })
  if (text) await userEvent.type(input, text)
  await userEvent.upload(container.querySelector('input[type="file"]')!, file)

  await waitFor(() => expect(uploadFilesInSession).toHaveBeenCalledWith([file], expect.any(String), []))
  const send = screen.getByRole('button', { name: 'Send' })
  await waitFor(() => expect(send).toBeEnabled())
  await userEvent.click(send)
  await waitFor(() =>
    expect(sendChatConversationMessage).toHaveBeenCalledWith('private-1', {
      content: expectedContent,
      attachmentUrl: '/uploads/11111111-1111-4111-8111-111111111111.jpg',
    })
  )
  expect(input).toHaveValue('')
  expect(screen.queryByAltText('garden.jpg')).not.toBeInTheDocument()
})

it('retains a failed upload for retry and lets the user remove it', async () => {
  vi.mocked(uploadFilesInSession)
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue({
      urls: ['/uploads/11111111-1111-4111-8111-111111111111.jpg'],
      sessionMedia: [],
    })
  const { container } = renderPage()
  await userEvent.click(await screen.findByRole('button', { name: /Sophie/ }))
  await userEvent.upload(
    container.querySelector('input[type="file"]')!,
    new File(['photo'], 'garden.jpg', { type: 'image/jpeg' })
  )

  expect(await screen.findByRole('alert')).toHaveTextContent("The attachment couldn't be uploaded")
  expect(screen.getByAltText('garden.jpg')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
  await waitFor(() => expect(uploadFilesInSession).toHaveBeenCalledTimes(2))
  await userEvent.click(screen.getByRole('button', { name: 'Remove attachment' }))
  expect(screen.queryByAltText('garden.jpg')).not.toBeInTheDocument()
})

it('confirms and removes an own message from the conversation cache', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  renderPage()
  await userEvent.click(await screen.findByRole('button', { name: /Sophie/ }))
  await userEvent.type(await screen.findByRole('textbox', { name: 'Message' }), 'Hello Sophie')
  await userEvent.click(screen.getByRole('button', { name: 'Send' }))
  expect(await screen.findByText('Hello Sophie')).toBeInTheDocument()

  await userEvent.click(screen.getByRole('button', { name: 'Delete message' }))
  await waitFor(() => expect(deleteChatMessage).toHaveBeenCalledWith('sent-message'))
  expect(window.confirm).toHaveBeenCalled()
  expect(screen.queryByText('Hello Sophie')).not.toBeInTheDocument()
})

it('loads older conversation pages without leaving the shell', async () => {
  vi.mocked(fetchChatConversationMessages)
    .mockResolvedValueOnce({
      items: [
        {
          id: 'newer-message',
          conversationId: 'private-1',
          groupId: null,
          authorId: 'user-2',
          author: { id: 'user-2', name: 'Sophie', avatarUrl: null },
          kind: 'USER',
          content: 'Newest',
          attachmentUrl: null,
          refPostId: null,
          createdAt: '2026-11-23T12:00:00Z',
          editedAt: null,
          encryption: 'none',
          encryptedPayload: null,
        },
      ],
      nextCursor: 'older-cursor',
    })
    .mockResolvedValueOnce({
      items: [
        {
          id: 'older-message',
          conversationId: 'private-1',
          groupId: null,
          authorId: 'user-1',
          author: { id: 'user-1', name: 'Grandpa John', avatarUrl: null },
          kind: 'USER',
          content: 'Oldest',
          attachmentUrl: null,
          refPostId: null,
          createdAt: '2026-11-22T12:00:00Z',
          editedAt: null,
          encryption: 'none',
          encryptedPayload: null,
        },
      ],
      nextCursor: null,
    })
  renderPage()
  await userEvent.click(await screen.findByRole('button', { name: /Sophie/ }))
  await userEvent.click(await screen.findByRole('button', { name: 'Load older messages' }))

  await waitFor(() =>
    expect(fetchChatConversationMessages).toHaveBeenLastCalledWith('private-1', { cursor: 'older-cursor' })
  )
  expect(screen.getByText('Oldest')).toBeInTheDocument()
})

it('resolves a family deep link without rewriting it', async () => {
  vi.mocked(fetchChatConversationMessages).mockResolvedValue({ items: [], nextCursor: null })
  renderPage('/chat?group=group-1')

  expect(await screen.findByRole('heading', { name: 'De Vries family' })).toBeInTheDocument()
  await waitFor(() => expect(fetchChatConversationMessages).toHaveBeenCalledWith('family-1', { cursor: undefined }))
  expect(screen.getByTestId('location')).toHaveTextContent('/chat?group=group-1')
  await waitFor(() => expect(markChatConversationRead).toHaveBeenCalledWith('family-1'))
})

it('shows an unavailable state for a stale conversation deep link', async () => {
  vi.mocked(fetchChatConversationMessages).mockRejectedValue({ response: { status: 404 } })
  renderPage('/chat?conversation=missing')

  expect(await screen.findByRole('heading', { name: 'This conversation is unavailable.' })).toBeInTheDocument()
  expect(screen.queryByRole('textbox', { name: 'Message' })).not.toBeInTheDocument()
})

it('preserves the legacy family chat and endpoints on unsupported servers', async () => {
  vi.mocked(fetchServerInfo).mockResolvedValue({ version: '0.9.0', features: [] })
  renderPage('/chat')

  expect(await screen.findByText('De Vries family')).toBeInTheDocument()
  await waitFor(() => expect(fetchChatMessages).toHaveBeenCalledWith('group-1', undefined))
  expect(fetchChatConversations).not.toHaveBeenCalled()
  expect(fetchChatPeople).not.toHaveBeenCalled()
  expect(markChatRead).toHaveBeenCalledWith('group-1')
})

it('uses a privacy-safe placeholder for unsupported encrypted messages', async () => {
  vi.mocked(fetchChatConversationMessages).mockResolvedValue({
    items: [
      {
        id: 'encrypted-message',
        conversationId: 'private-1',
        groupId: null,
        authorId: 'user-2',
        author: { id: 'user-2', name: 'Sophie', avatarUrl: null },
        kind: 'USER',
        content: 'secret plaintext',
        attachmentUrl: '/uploads/private-secret.jpg',
        refPostId: null,
        createdAt: '2026-11-23T10:00:00Z',
        editedAt: null,
        encryption: 'future-cipher',
        encryptedPayload: { ciphertext: 'opaque' },
      },
    ],
    nextCursor: null,
  })
  renderPage()
  await userEvent.click(await screen.findByRole('button', { name: /Sophie/ }))

  expect(await screen.findByText('Encrypted message')).toBeInTheDocument()
  expect(screen.queryByText('secret plaintext')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'View attachment' })).not.toBeInTheDocument()
})

it('never exposes an unsupported encrypted inbox preview', async () => {
  vi.mocked(fetchChatConversations).mockResolvedValue({
    items: [
      {
        ...{
          id: 'private-encrypted',
          kind: 'PRIVATE' as const,
          participants: [
            { id: 'user-1', name: 'Grandpa John', avatarUrl: null },
            { id: 'user-2', name: 'Sophie', avatarUrl: null },
          ],
          unreadCount: 1,
          updatedAt: '2026-11-23T10:00:00Z',
        },
        lastMessage: {
          id: 'secret-preview',
          authorId: 'user-2',
          content: null,
          hasAttachment: false,
          createdAt: '2026-11-23T10:00:00Z',
          encryption: 'future-cipher',
        },
      },
    ],
  })
  renderPage()

  expect(await screen.findByText('Encrypted message')).toBeInTheDocument()
  expect(screen.queryByText('secret plaintext')).not.toBeInTheDocument()
})

it('opens a supported conversation attachment in the shared lightbox', async () => {
  vi.mocked(fetchChatConversationMessages).mockResolvedValue({
    items: [
      {
        id: 'attachment-message',
        conversationId: 'private-1',
        groupId: null,
        authorId: 'user-2',
        author: { id: 'user-2', name: 'Sophie', avatarUrl: null },
        kind: 'USER',
        content: 'Garden',
        attachmentUrl: '/uploads/22222222-2222-4222-8222-222222222222.jpg',
        refPostId: null,
        createdAt: '2026-11-23T10:00:00Z',
        editedAt: null,
        encryption: 'none',
        encryptedPayload: null,
      },
    ],
    nextCursor: null,
  })
  renderPage()
  await userEvent.click(await screen.findByRole('button', { name: /Sophie/ }))
  await userEvent.click(await screen.findByRole('button', { name: 'View attachment' }))

  expect(screen.getByRole('dialog')).toBeInTheDocument()
})

it('preserves family milestones and replies through the legacy family endpoint', async () => {
  vi.mocked(fetchChatConversationMessages).mockResolvedValue({
    items: [
      {
        id: 'family-system',
        conversationId: 'family-1',
        groupId: 'group-1',
        authorId: 'user-2',
        author: { id: 'user-2', name: 'Sophie', avatarUrl: null },
        kind: 'SYSTEM_MILESTONE',
        content: 'Sophie added a milestone',
        attachmentUrl: null,
        refPostId: 'post-1',
        createdAt: '2026-11-23T11:00:00Z',
        editedAt: null,
        encryption: 'none',
        encryptedPayload: null,
      },
      {
        id: 'family-message',
        conversationId: 'family-1',
        groupId: 'group-1',
        authorId: 'user-2',
        author: { id: 'user-2', name: 'Sophie', avatarUrl: null },
        kind: 'USER',
        content: 'Family original',
        attachmentUrl: null,
        refPostId: null,
        createdAt: '2026-11-23T10:00:00Z',
        editedAt: null,
        encryption: 'none',
        encryptedPayload: null,
        replyTo: {
          id: 'older-family-message',
          authorId: 'user-1',
          authorName: 'Grandpa John',
          kind: 'USER',
          content: 'Earlier',
          attachmentUrl: null,
        },
      } as never,
    ],
    nextCursor: null,
  })
  renderPage()
  await userEvent.click(await screen.findByRole('button', { name: /De Vries family/ }))

  expect(screen.getByText('Sophie added a milestone')).toBeInTheDocument()
  expect(screen.getByText('Earlier')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Reply to Sophie' }))
  expect(screen.getByText('Replying to Sophie')).toBeInTheDocument()
  await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), 'Replying here')
  await userEvent.click(screen.getByRole('button', { name: 'Send' }))

  await waitFor(() =>
    expect(sendChatMessage).toHaveBeenCalledWith('group-1', {
      content: 'Replying here',
      attachmentUrl: undefined,
      replyToMessageId: 'family-message',
    })
  )
  expect(sendChatConversationMessage).not.toHaveBeenCalled()
})

it('polls only the active conversation while the document is visible', async () => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  const user = userEvent.setup()
  try {
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: /Sophie/ })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /Sophie/ }))
    await waitFor(() => expect(fetchChatConversationMessages).toHaveBeenCalledOnce())

    await waitFor(() => expect(fetchChatConversationMessages).toHaveBeenCalledTimes(2), { timeout: 7000 })

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
    await new Promise((resolve) => setTimeout(resolve, 6500))
    expect(fetchChatConversationMessages).toHaveBeenCalledTimes(2)
  } finally {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  }
}, 15000)
