import React from 'react'
import { render, fireEvent, waitFor } from '@testing-library/react-native'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { Post } from '@/types'
// jest.mock calls below are hoisted above these imports.
import { EventBody } from '@/components/EventBody'
import { rsvpEvent } from '@famlin/api-client'
import { patchPostInCaches } from '@/utils/postCache'

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { date?: string }) => {
      const labels: Record<string, string> = {
        'event.yes': 'Going',
        'event.maybe': 'Maybe',
        'event.no': "Can't go",
        'event.closed': 'Replies closed',
        'event.rsvpFailed': "Couldn't save your reply",
      }
      if (key === 'event.rsvpBy') return `Reply by ${options?.date}`
      return labels[key] ?? key
    },
    i18n: { language: 'en-GB' },
  }),
}))

jest.mock('@famlin/api-client', () => ({
  RSVP_RESPONSES: ['yes', 'maybe', 'no'],
  rsvpEvent: jest.fn(),
}))

jest.mock('@/utils/postCache', () => ({
  patchPostInCaches: jest.fn(),
}))

jest.mock('@/components/Icon', () => ({ Icon: () => null }))

jest.setTimeout(15000)

function makeEventPost(event: Partial<NonNullable<Post['event']>> = {}): Post {
  return {
    id: 'post-1',
    authorId: 'u1',
    author: { id: 'u1', name: 'Alice' },
    groupId: 'g1',
    content: 'Sunday lunch',
    type: 'EVENT',
    uploadedAssetUrls: [],
    createdAt: new Date().toISOString(),
    commentCount: 0,
    likeCount: 0,
    likedByMe: false,
    myReaction: null,
    reactions: {},
    favoritedByMe: false,
    event: {
      startsAt: new Date(2026, 10, 15, 13, 0).toISOString(),
      endsAt: new Date(2026, 10, 15, 16, 0).toISOString(),
      location: "Grandma's garden",
      rsvpDeadline: new Date(2026, 10, 13, 20, 0).toISOString(),
      closed: false,
      myRsvp: 'yes',
      counts: { yes: 2, maybe: 1, no: 0 },
      responses: {
        yes: [
          { id: 'u1', name: 'Alice', avatarUrl: null },
          { id: 'u2', name: 'Bob', avatarUrl: null },
        ],
        maybe: [{ id: 'u3', name: 'Carol', avatarUrl: null }],
        no: [],
      },
      ...event,
    },
  } as Post
}

const createdQueryClients: QueryClient[] = []

async function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { gcTime: Infinity }, mutations: { gcTime: Infinity } },
  })
  createdQueryClients.push(queryClient)
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('EventBody', () => {
  beforeEach(() => jest.clearAllMocks())
  afterEach(() => createdQueryClients.splice(0).forEach((client) => client.clear()))

  it('shows when, where, the reply-by date and the guest list', async () => {
    const screen = await renderWithClient(<EventBody post={makeEventPost()} />)

    expect(screen.getByText(/15 November 2026.*– 16:00$/)).toBeTruthy()
    expect(screen.getByText("Grandma's garden")).toBeTruthy()
    expect(screen.getByText(/^Reply by /)).toBeTruthy()
    expect(screen.getByText('Alice, Bob')).toBeTruthy()
    expect(screen.getByText('Carol')).toBeTruthy()
    expect(screen.queryByTestId('event-guests-no')).toBeNull()
  })

  it('marks the viewer’s own answer as selected', async () => {
    const screen = await renderWithClient(<EventBody post={makeEventPost()} />)

    expect(screen.getByTestId('event-rsvp-yes').props.accessibilityState).toMatchObject({ selected: true })
    expect(screen.getByTestId('event-rsvp-maybe').props.accessibilityState).toMatchObject({ selected: false })
  })

  it('sends the tapped answer and puts the returned post in the caches', async () => {
    const updated = makeEventPost({ myRsvp: 'maybe' })
    jest.mocked(rsvpEvent).mockResolvedValue(updated)
    const screen = await renderWithClient(<EventBody post={makeEventPost()} />)

    fireEvent.press(screen.getByTestId('event-rsvp-maybe'))

    await waitFor(() => expect(rsvpEvent).toHaveBeenCalledWith('post-1', 'maybe'))
    await waitFor(() => expect(patchPostInCaches).toHaveBeenCalled())
    const updater = jest.mocked(patchPostInCaches).mock.calls[0][2]
    expect(updater(makeEventPost())).toBe(updated)
  })

  it('shows an error when saving the answer fails', async () => {
    jest.mocked(rsvpEvent).mockRejectedValue(new Error('network'))
    const screen = await renderWithClient(<EventBody post={makeEventPost()} />)

    fireEvent.press(screen.getByTestId('event-rsvp-no'))

    await waitFor(() => expect(screen.getByText("Couldn't save your reply")).toBeTruthy())
  })

  it('disables answering and hides the deadline once replies are closed', async () => {
    const screen = await renderWithClient(<EventBody post={makeEventPost({ closed: true })} />)

    expect(screen.getByText('Replies closed')).toBeTruthy()
    expect(screen.queryByText(/^Reply by /)).toBeNull()
    fireEvent.press(screen.getByTestId('event-rsvp-maybe'))
    expect(rsvpEvent).not.toHaveBeenCalled()
  })

  it('renders nothing without the server’s event view', async () => {
    const post = { ...makeEventPost(), event: undefined }
    const screen = await renderWithClient(<EventBody post={post} />)

    expect(screen.toJSON()).toBeNull()
  })
})
