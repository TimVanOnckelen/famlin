import { Story } from '@famlin/api-client';

export function makeStory(overrides: Partial<Story> = {}): Story {
  return {
    id: 'story-1',
    groupId: 'group-1',
    group: { id: 'group-1', name: 'Familie de Vries' },
    circleId: null,
    circle: null,
    author: { id: 'user-2', name: 'Sophie Jansen', avatarUrl: null },
    imageUrl: '/uploads/11111111-2222-3333-4444-555555555555.jpg',
    createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    expiresAt: new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString(),
    pinnedAt: null,
    expired: false,
    isMine: false,
    seen: false,
    myReaction: null,
    myReply: null,
    stats: null,
    ...overrides,
  };
}
