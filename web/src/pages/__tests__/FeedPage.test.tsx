import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLocation } from 'react-router'
import { FeedPage } from '@/pages/FeedPage'
import { createTestQueryClient, makePost, makeUser, renderWithQueryClient } from '@/test/fixtures'
import { fetchGroups, fetchMyCircles, fetchPosts, fetchGroupMembers, fetchOnThisDay } from '@famlin/api-client'

vi.mock('@famlin/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@famlin/api-client')>()),
  fetchGroups: vi.fn(),
  fetchMyCircles: vi.fn(),
  fetchPosts: vi.fn(),
  fetchGroupMembers: vi.fn(),
  fetchOnThisDay: vi.fn(),
}))

// Surfaces the router's current location as text, so a test can assert on
// the background-location navigation FeedPage's card click/keyboard-open do
// (useOpenPostModal, utils/routes.ts) without needing the real App.tsx route
// tree (which renders PostDetailModal) mounted alongside it.
function LocationProbe() {
  const location = useLocation()
  return (
    <div data-testid="location-probe">
      {location.pathname}|{JSON.stringify(location.state)}
    </div>
  )
}

const familyFilter = () => within(screen.getByRole('group', { name: 'Filter by family' }))
async function findFamilyButton(name: string) {
  const filter = await screen.findByRole('group', { name: 'Filter by family' })
  return within(filter).getByRole('button', { name })
}

const groups = [
  { id: 'group-1', name: 'Familie de Vries', createdAt: '2026-01-01T00:00:00Z', chitchatEnabled: false },
  { id: 'group-2', name: 'Neefjes', createdAt: '2026-01-01T00:00:00Z', chitchatEnabled: false },
]

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(fetchGroupMembers).mockResolvedValue([])
  vi.mocked(fetchOnThisDay).mockResolvedValue([])
  vi.mocked(fetchGroups).mockResolvedValue(groups)
  // No circles by default — the circle filter row only appears for a viewer
  // who is actually in one.
  vi.mocked(fetchMyCircles).mockResolvedValue([])
  vi.mocked(fetchPosts).mockResolvedValue({ items: [makePost()], nextCursor: null })
})

describe('FeedPage', () => {
  it('shows every family by default (no group filter sent)', async () => {
    renderWithQueryClient(<FeedPage user={makeUser()} onOpenProfile={() => {}} onLogout={() => {}} />)
    expect(await screen.findByText('Lovely day in the garden.')).toBeInTheDocument()
    expect(fetchPosts).toHaveBeenCalledWith({ groupIds: [], circleIds: [], cursor: undefined })
  })

  it('filters to one family and back to all', async () => {
    const user = userEvent.setup()
    renderWithQueryClient(<FeedPage user={makeUser()} onOpenProfile={() => {}} onLogout={() => {}} />)

    await user.click(await findFamilyButton('Neefjes'))
    await waitFor(() =>
      expect(fetchPosts).toHaveBeenCalledWith({ groupIds: ['group-2'], circleIds: [], cursor: undefined })
    )

    await user.click(familyFilter().getByRole('button', { name: 'All families' }))
    await waitFor(() => expect(fetchPosts).toHaveBeenLastCalledWith({ groupIds: [], circleIds: [], cursor: undefined }))
  })

  it('offers circle chips and narrows the feed to just that circle', async () => {
    // Only circles the viewer is in ever come back from the server — a group
    // member outside a circle receives an empty list, so there is nothing for
    // this component to hide.
    vi.mocked(fetchMyCircles).mockResolvedValue([
      {
        id: 'circle-1',
        groupId: 'group-1',
        name: 'Grandparents',
        memberCount: 3,
        createdAt: '2026-01-01T00:00:00Z',
      },
    ])

    renderWithQueryClient(<FeedPage user={makeUser()} onOpenProfile={() => {}} onLogout={() => {}} />)

    const chip = await screen.findByRole('button', { name: 'Grandparents' })
    await userEvent.click(chip)

    await waitFor(() =>
      expect(fetchPosts).toHaveBeenLastCalledWith({
        groupIds: [],
        circleIds: ['circle-1'],
        cursor: undefined,
      })
    )
  })

  it('hides the circle filter row when the viewer is in no circles', async () => {
    renderWithQueryClient(<FeedPage user={makeUser()} onOpenProfile={() => {}} onLogout={() => {}} />)
    await findFamilyButton('Familie de Vries')
    expect(screen.queryByRole('group', { name: /circle/i })).not.toBeInTheDocument()
  })

  it('selects multiple families at once', async () => {
    const user = userEvent.setup()
    renderWithQueryClient(<FeedPage user={makeUser()} onOpenProfile={() => {}} onLogout={() => {}} />)

    await user.click(await findFamilyButton('Familie de Vries'))
    await user.click(familyFilter().getByRole('button', { name: 'Neefjes' }))
    await waitFor(() =>
      expect(fetchPosts).toHaveBeenCalledWith({ groupIds: ['group-1', 'group-2'], circleIds: [], cursor: undefined })
    )
  })

  it('hides the filter for single-family users', async () => {
    vi.mocked(fetchGroups).mockResolvedValue([groups[0]])
    renderWithQueryClient(<FeedPage user={makeUser()} onOpenProfile={() => {}} onLogout={() => {}} />)
    await screen.findByText('Lovely day in the garden.')
    expect(screen.queryByRole('button', { name: 'All families' })).not.toBeInTheDocument()
  })

  it('shows the empty state when there are no posts', async () => {
    vi.mocked(fetchPosts).mockResolvedValue({ items: [], nextCursor: null })
    renderWithQueryClient(<FeedPage user={makeUser()} onOpenProfile={() => {}} onLogout={() => {}} />)
    expect(await screen.findByText(/No posts yet/)).toBeInTheDocument()
  })

  it('explains the no-family state and drops every New post affordance for groupless users', async () => {
    vi.mocked(fetchGroups).mockResolvedValue([])
    vi.mocked(fetchPosts).mockResolvedValue({ items: [], nextCursor: null })
    renderWithQueryClient(<FeedPage user={makeUser()} onOpenProfile={() => {}} onLogout={() => {}} />)

    expect(await screen.findByText(/not part of any family/)).toBeInTheDocument()
    // Neither the feed empty state's button nor the shell's sidebar one.
    expect(screen.queryByRole('button', { name: 'New post' })).not.toBeInTheDocument()
  })

  it('drops the New post affordance on the very first render for a bootstrapped-groupless cold load', () => {
    // App.tsx's bootstrap seeded ['groups'] with [] before the first route
    // rendered — no waitFor: the composer affordance must never flash in for
    // a user in no families.
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(['groups'], [])
    renderWithQueryClient(<FeedPage user={makeUser()} onOpenProfile={() => {}} onLogout={() => {}} />, { queryClient })

    expect(screen.queryByRole('button', { name: 'New post' })).not.toBeInTheDocument()
  })

  it('renders the family filter on the very first render from the bootstrapped groups list', () => {
    // A member of families gets their filter chips before any fetch answers —
    // the cold load costs them nothing.
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(['groups'], groups)
    renderWithQueryClient(<FeedPage user={makeUser()} onOpenProfile={() => {}} onLogout={() => {}} />, { queryClient })

    expect(familyFilter().getByRole('button', { name: 'Familie de Vries' })).toBeInTheDocument()
    expect(familyFilter().getByRole('button', { name: 'Neefjes' })).toBeInTheDocument()
  })

  it('offers Show more only when a next cursor exists', async () => {
    vi.mocked(fetchPosts).mockResolvedValue({ items: [makePost()], nextCursor: 'cursor-2' })
    renderWithQueryClient(<FeedPage user={makeUser()} onOpenProfile={() => {}} onLogout={() => {}} />)
    expect(await screen.findByRole('button', { name: 'Show more' })).toBeInTheDocument()
  })

  describe('opening the post detail modal', () => {
    it('clicking a card opens the detail modal over the feed (background-location navigation)', async () => {
      const user = userEvent.setup()
      renderWithQueryClient(
        <>
          <FeedPage user={makeUser()} onOpenProfile={() => {}} onLogout={() => {}} />
          <LocationProbe />
        </>
      )

      const card = await screen.findByRole('article')
      await user.click(card)

      const probe = screen.getByTestId('location-probe')
      expect(probe.textContent).toContain('/posts/post-1')
      expect(probe.textContent).toContain('backgroundLocation')
    })

    it('clicking the comment count also opens the detail modal', async () => {
      const user = userEvent.setup()
      renderWithQueryClient(
        <>
          <FeedPage user={makeUser()} onOpenProfile={() => {}} onLogout={() => {}} />
          <LocationProbe />
        </>
      )

      await user.click(await screen.findByRole('button', { name: /comments/ }))

      expect(screen.getByTestId('location-probe').textContent).toContain('/posts/post-1')
    })

    it('does not open the modal when clicking the reaction button', async () => {
      const user = userEvent.setup()
      renderWithQueryClient(
        <>
          <FeedPage user={makeUser()} onOpenProfile={() => {}} onLogout={() => {}} />
          <LocationProbe />
        </>
      )

      await user.click(await screen.findByRole('button', { name: /^0$/ }))

      expect(screen.getByTestId('location-probe').textContent).toBe('/|null')
    })
  })

  describe('keyboard navigation (j/k/o)', () => {
    it('j/k move focus between cards and o opens the focused one', async () => {
      vi.mocked(fetchPosts).mockResolvedValue({
        items: [makePost({ id: 'post-1' }), makePost({ id: 'post-2', content: 'Second post' })],
        nextCursor: null,
      })
      const user = userEvent.setup()
      renderWithQueryClient(
        <>
          <FeedPage user={makeUser()} onOpenProfile={() => {}} onLogout={() => {}} />
          <LocationProbe />
        </>
      )

      await screen.findByText('Second post')
      const cards = screen.getAllByRole('article')
      expect(cards).toHaveLength(2)

      await user.keyboard('j')
      expect(cards[0]).toHaveFocus()

      await user.keyboard('j')
      expect(cards[1]).toHaveFocus()

      await user.keyboard('k')
      expect(cards[0]).toHaveFocus()

      await user.keyboard('o')
      expect(screen.getByTestId('location-probe').textContent).toContain('/posts/post-1')
    })
  })
})

it('opens search with the current single-family filter', async () => {
  const onOpenSearch = vi.fn()
  renderWithQueryClient(
    <FeedPage user={makeUser()} onOpenProfile={() => {}} onOpenSearch={onOpenSearch} onLogout={() => {}} />
  )
  await screen.findByText('Lovely day in the garden.')
  await userEvent.click(familyFilter().getByRole('button', { name: 'Neefjes' }))
  await userEvent.click(screen.getAllByRole('button', { name: 'Search' })[0])
  expect(onOpenSearch).toHaveBeenCalledWith('group-2')
})

it('keeps the same side panel mounted when switching between one and multiple families', async () => {
  renderWithQueryClient(<FeedPage user={makeUser()} onOpenProfile={() => {}} onLogout={() => {}} />)
  const panel = await screen.findByRole('complementary', { name: 'Family details' })
  await userEvent.click(familyFilter().getByRole('button', { name: 'Neefjes' }))
  expect(screen.getByRole('complementary', { name: 'Family details' })).toBe(panel)
  await userEvent.click(familyFilter().getByRole('button', { name: 'All families' }))
  expect(screen.getByRole('complementary', { name: 'Family details' })).toBe(panel)
})

it('shares the family selection between narrow-screen chips and the desktop sidebar', async () => {
  renderWithQueryClient(<FeedPage user={makeUser()} onOpenProfile={() => {}} onLogout={() => {}} />)
  const panel = await screen.findByRole('complementary', { name: 'Family details' })
  await userEvent.click(within(panel).getByRole('button', { name: 'Neefjes' }))
  expect(familyFilter().getByRole('button', { name: 'Neefjes' })).toHaveAttribute('aria-pressed', 'true')
  await userEvent.click(familyFilter().getByRole('button', { name: 'All families' }))
  expect(within(panel).getByRole('button', { name: 'All families' })).toHaveAttribute('aria-pressed', 'true')
})
