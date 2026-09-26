import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StoryViewer, STORY_DURATION_MS } from '@/components/StoryViewer';
import { renderWithQueryClient } from '@/test/fixtures';
import { makeStory } from '@/test/storyFixtures';
import {
  fetchStoryReactions,
  fetchStoryReplies,
  fetchStoryViews,
  markStoryViewed,
  reactToStory,
  replyToStory,
} from '@famlin/api-client';

vi.mock('@famlin/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@famlin/api-client')>()),
  markStoryViewed: vi.fn(),
  reactToStory: vi.fn(),
  replyToStory: vi.fn(),
  fetchStoryViews: vi.fn(),
  fetchStoryReactions: vi.fn(),
  fetchStoryReplies: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(markStoryViewed).mockResolvedValue();
});

describe('StoryViewer', () => {
  it("records a view and lets a viewer react to someone else's story", async () => {
    const user = userEvent.setup();
    vi.mocked(reactToStory).mockResolvedValue({ myReaction: 'LOVE' });
    renderWithQueryClient(<StoryViewer sequences={[[makeStory()]]} onClose={() => {}} />);

    expect(markStoryViewed).toHaveBeenCalledWith('story-1');
    await user.click(screen.getByRole('button', { name: 'Love' }));
    expect(reactToStory).toHaveBeenCalledWith('story-1', 'LOVE');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Love' })).toHaveAttribute('aria-pressed', 'true'));
  });

  it('sends one private reply, then shows it instead of the input', async () => {
    const user = userEvent.setup();
    vi.mocked(replyToStory).mockResolvedValue({ content: 'So cute!', createdAt: new Date().toISOString() });
    renderWithQueryClient(<StoryViewer sequences={[[makeStory()]]} onClose={() => {}} />);

    await user.type(screen.getByRole('textbox', { name: 'Private reply' }), 'So cute!');
    await user.click(screen.getByRole('button', { name: 'Send reply' }));

    expect(replyToStory).toHaveBeenCalledWith('story-1', 'So cute!');
    expect(await screen.findByText('You replied: "So cute!"')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Private reply' })).not.toBeInTheDocument();
  });

  it('offers no reply box on an expired Highlight', () => {
    const highlight = makeStory({
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      expired: true,
      pinnedAt: new Date().toISOString(),
    });
    renderWithQueryClient(<StoryViewer sequences={[[highlight]]} onClose={() => {}} />);
    expect(screen.queryByRole('textbox', { name: 'Private reply' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Love' })).toBeInTheDocument();
  });

  it('shows the author their viewers and replies, with no pin or delete on web', async () => {
    const user = userEvent.setup();
    vi.mocked(fetchStoryViews).mockResolvedValue([
      { id: 'user-3', name: 'Emma', avatarUrl: null, viewedAt: new Date().toISOString() },
    ]);
    vi.mocked(fetchStoryReactions).mockResolvedValue([]);
    vi.mocked(fetchStoryReplies).mockResolvedValue([
      { id: 'r1', fromUser: { id: 'user-3', name: 'Emma', avatarUrl: null }, content: 'Beautiful', createdAt: new Date().toISOString() },
    ]);
    const mine = makeStory({ isMine: true, seen: true, stats: { viewCount: 1, reactionCount: 0, replyCount: 1 } });
    renderWithQueryClient(<StoryViewer sequences={[[mine]]} onClose={() => {}} />);

    expect(screen.queryByRole('button', { name: 'Love' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /pin|delete/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Seen by 1/ }));
    expect(await screen.findByText('Emma')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Replies' }));
    expect(await screen.findByText('Beautiful')).toBeInTheDocument();
  });

  it('auto-advances through a run and closes after the last story', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    renderWithQueryClient(
      <StoryViewer sequences={[[makeStory(), makeStory({ id: 'story-2' })]]} onClose={onClose} />
    );
    act(() => {
      vi.advanceTimersByTime(STORY_DURATION_MS + 200);
    });
    expect(markStoryViewed).toHaveBeenCalledWith('story-2');
    act(() => {
      vi.advanceTimersByTime(STORY_DURATION_MS + 200);
    });
    expect(onClose).toHaveBeenCalled();
    vi.useRealTimers();
  });
});
