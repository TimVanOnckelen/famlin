import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StoryTray } from '@/components/StoryTray';
import { renderWithQueryClient } from '@/test/fixtures';
import { makeStory } from '@/test/storyFixtures';
import { fetchStoryHighlights, fetchStoryTray, markStoryViewed } from '@famlin/api-client';

vi.mock('@famlin/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@famlin/api-client')>()),
  fetchStoryTray: vi.fn(),
  fetchStoryHighlights: vi.fn(),
  markStoryViewed: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(markStoryViewed).mockResolvedValue();
  vi.mocked(fetchStoryHighlights).mockResolvedValue({ items: [], nextCursor: null });
});

describe('StoryTray', () => {
  it('lists authors, follows the family filter and opens the viewer', async () => {
    const user = userEvent.setup();
    vi.mocked(fetchStoryTray).mockResolvedValue({
      authors: [
        {
          author: { id: 'user-2', name: 'Sophie Jansen', avatarUrl: null },
          hasUnseen: true,
          latestAt: new Date().toISOString(),
          stories: [makeStory()],
        },
      ],
    });
    renderWithQueryClient(<StoryTray groupIds={['group-1']} enabled />);

    await user.click(await screen.findByRole('listitem', { name: "View Sophie Jansen's new story" }));
    expect(fetchStoryTray).toHaveBeenCalledWith(['group-1']);
    expect(screen.getByRole('dialog', { name: 'Story' })).toBeInTheDocument();
  });

  it('shows Highlights in the order the server returns them (newest first)', async () => {
    vi.mocked(fetchStoryTray).mockResolvedValue({ authors: [] });
    vi.mocked(fetchStoryHighlights).mockResolvedValue({
      items: [
        makeStory({ id: 'h-new', author: { id: 'a', name: 'Newest', avatarUrl: null }, pinnedAt: new Date().toISOString() }),
        makeStory({ id: 'h-old', author: { id: 'b', name: 'Oldest', avatarUrl: null }, pinnedAt: new Date().toISOString() }),
      ],
      nextCursor: null,
    });
    renderWithQueryClient(<StoryTray groupIds={[]} enabled />);

    const items = await screen.findAllByRole('listitem', { name: /highlight/ });
    expect(items.map((el) => el.getAttribute('aria-label'))).toEqual([
      "View Newest's highlight",
      "View Oldest's highlight",
    ]);
  });

  it('fetches nothing and renders nothing when stories are off', () => {
    const { container } = renderWithQueryClient(<StoryTray groupIds={[]} enabled={false} />);
    expect(fetchStoryTray).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });
});
