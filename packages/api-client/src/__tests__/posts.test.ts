// posts.ts is stateless (no module-level singletons), but we still mock
// `../client`'s `api` the same way __tests__/uploads.test.ts does, so these
// tests never touch a real network.
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../client', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

describe('posts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('interactWithPost', () => {
    it('POSTs { key, value } to /posts/:postId/interactions and returns the full post', async () => {
      const client = await import('../client');
      const fakePost = { id: 'post-1', type: 'POLL' };
      (client.api.post as any).mockResolvedValue({ data: fakePost });

      const { interactWithPost } = await import('../posts');
      const result = await interactWithPost('post-1', 'vote', { optionId: 'opt-1' });

      expect(client.api.post).toHaveBeenCalledWith('/posts/post-1/interactions', {
        key: 'vote',
        value: { optionId: 'opt-1' },
      });
      expect(result).toBe(fakePost);
    });

    it('omits value from the payload (as undefined) when not provided', async () => {
      const client = await import('../client');
      const fakePost = { id: 'post-2', type: 'POLL' };
      (client.api.post as any).mockResolvedValue({ data: fakePost });

      const { interactWithPost } = await import('../posts');
      await interactWithPost('post-2', 'some-key');

      expect(client.api.post).toHaveBeenCalledWith('/posts/post-2/interactions', {
        key: 'some-key',
        value: undefined,
      });
    });
  });

  describe('votePoll', () => {
    it('delegates to interactWithPost with key "vote" and { optionId }', async () => {
      const client = await import('../client');
      const fakePost = { id: 'post-3', type: 'POLL' };
      (client.api.post as any).mockResolvedValue({ data: fakePost });

      const { votePoll } = await import('../posts');
      const result = await votePoll('post-3', 'opt-2');

      expect(client.api.post).toHaveBeenCalledWith('/posts/post-3/interactions', {
        key: 'vote',
        value: { optionId: 'opt-2' },
      });
      expect(result).toBe(fakePost);
    });
  });
});
