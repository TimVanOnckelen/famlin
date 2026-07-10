import { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Post, Comment, User } from '@famlin/api-client';

export function makePost(overrides: Partial<Post> = {}): Post {
  return {
    id: 'post-1',
    authorId: 'user-1',
    author: { id: 'user-1', name: 'Grandpa John', avatarUrl: null },
    groupId: 'group-1',
    group: { id: 'group-1', name: 'Familie de Vries' },
    content: 'Lovely day in the garden.',
    type: 'UPDATE',
    milestoneTag: null,
    uploadedAssetUrls: [],
    createdAt: '2026-07-08T10:00:00Z',
    editedAt: null,
    latitude: null,
    longitude: null,
    locationName: null,
    commentCount: 0,
    likeCount: 0,
    likedByMe: false,
    myReaction: null,
    reactions: {},
    favoritedByMe: false,
    ...overrides,
  };
}

export function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 'comment-1',
    postId: 'post-1',
    authorId: 'user-2',
    author: { id: 'user-2', name: 'Sophie', avatarUrl: null },
    content: 'So lovely!',
    createdAt: '2026-07-08T11:00:00Z',
    editedAt: null,
    parentId: null,
    assetUrl: null,
    attachmentUrl: null,
    likeCount: 0,
    likedByMe: false,
    myReaction: null,
    reactions: {},
    ...overrides,
  };
}

export function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'john@example.com',
    name: 'Grandpa John',
    avatarUrl: null,
    isAdmin: false,
    hasPassword: true,
    emailOnNewPost: true,
    emailOnNewComment: true,
    emailOnNewLike: true,
    pushOnNewPost: true,
    pushOnNewComment: true,
    pushOnNewLike: true,
    ...overrides,
  };
}

// Every component under test assumes a react-query provider; retries are off
// so error paths settle immediately.
export function renderWithQueryClient(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return {
    queryClient,
    ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>),
  };
}
