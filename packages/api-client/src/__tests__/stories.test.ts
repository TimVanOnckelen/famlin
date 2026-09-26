import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../client', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

describe('stories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends the group filter as a comma-separated groupIds param', async () => {
    const client = await import('../client');
    (client.api.get as any).mockResolvedValue({ data: { authors: [] } });

    const { fetchStoryTray } = await import('../stories');
    await fetchStoryTray(['g1', 'g2']);
    expect(client.api.get).toHaveBeenCalledWith('/stories', { params: { groupIds: 'g1,g2' } });

    await fetchStoryTray([]);
    expect(client.api.get).toHaveBeenLastCalledWith('/stories', { params: {} });
  });

  it('pages Highlights with a cursor', async () => {
    const client = await import('../client');
    (client.api.get as any).mockResolvedValue({ data: { items: [], nextCursor: null } });

    const { fetchStoryHighlights } = await import('../stories');
    await fetchStoryHighlights(['g1'], 'cur');
    expect(client.api.get).toHaveBeenCalledWith('/stories/highlights', { params: { groupIds: 'g1', cursor: 'cur' } });
  });

  it('posts a reaction and a reply', async () => {
    const client = await import('../client');
    (client.api.post as any).mockResolvedValue({ data: { myReaction: 'LOVE' } });

    const { reactToStory, replyToStory } = await import('../stories');
    expect(await reactToStory('s1', 'LOVE')).toEqual({ myReaction: 'LOVE' });
    expect(client.api.post).toHaveBeenCalledWith('/stories/s1/reaction', { type: 'LOVE' });

    await replyToStory('s1', 'Hi!');
    expect(client.api.post).toHaveBeenLastCalledWith('/stories/s1/reply', { content: 'Hi!' });
  });

  it('isStoryLive compares expiresAt against now', async () => {
    const { isStoryLive } = await import('../stories');
    const now = new Date('2026-01-01T12:00:00Z');
    expect(isStoryLive({ expiresAt: '2026-01-01T12:00:01Z' }, now)).toBe(true);
    expect(isStoryLive({ expiresAt: '2026-01-01T11:59:59Z' }, now)).toBe(false);
  });
});
