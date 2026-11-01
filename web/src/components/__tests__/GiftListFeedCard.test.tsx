import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PostCard } from '@/components/PostCard'
import { makePost, renderWithQueryClient } from '@/test/fixtures'
import type { GiftListEnrichment } from '@famlin/api-client'

function makeGiftList(overrides: Partial<GiftListEnrichment> = {}): GiftListEnrichment {
  return {
    title: 'Christmas 2026',
    occasionDate: '2026-12-25',
    drawEnabled: true,
    budget: '€25',
    drawn: false,
    drawnAt: null,
    managerId: 'u1',
    isManager: false,
    participants: [
      { id: 'u1', name: 'Grandpa John', avatarUrl: null, itemCount: 2 },
      { id: 'u2', name: 'Emma', avatarUrl: null, itemCount: 0 },
      { id: 'u3', name: 'Liam', avatarUrl: null, itemCount: 1 },
    ],
    itemCount: 3,
    exclusions: null,
    myRecipient: null,
    ...overrides,
  }
}

describe('GiftListFeedCard', () => {
  it('shows the title, participants and that the names are not drawn yet', () => {
    renderWithQueryClient(<PostCard post={makePost({ type: 'GIFT_LIST', giftList: makeGiftList() })} />)
    expect(screen.getByText('Christmas 2026')).toBeInTheDocument()
    expect(screen.getByText(/3 participants/)).toBeInTheDocument()
    expect(screen.getByText(/Budget €25/)).toBeInTheDocument()
    expect(screen.getByText('Names not drawn yet')).toBeInTheDocument()
  })

  it("shows who you're buying for once drawn, and opens the gift list", async () => {
    const onOpen = vi.fn()
    renderWithQueryClient(
      <PostCard
        post={makePost({
          id: 'gift-1',
          type: 'GIFT_LIST',
          giftList: makeGiftList({ drawn: true, myRecipient: { id: 'u2', name: 'Emma', avatarUrl: null } }),
        })}
        onOpenGiftList={onOpen}
      />
    )
    expect(screen.getByText("You're buying for Emma")).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Open gift list' }))
    expect(onOpen).toHaveBeenCalledWith('gift-1')
  })
})
