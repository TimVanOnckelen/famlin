import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { Post } from '@/types';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => {
      switch (key) {
        case 'poll.votes':
          return `${options?.count} votes`;
        case 'poll.totalVotes':
          return `${options?.count} total votes`;
        case 'poll.closed':
          return 'Poll closed';
        case 'poll.myVote':
          return 'Your vote';
        case 'poll.vote':
          return 'Vote';
        default:
          return key;
      }
    },
  }),
}));

jest.mock('@famlin/api-client', () => ({
  votePoll: jest.fn(),
}));

jest.mock('@/utils/postCache', () => ({
  patchPostInCaches: jest.fn(),
}));

import { PollBody } from '@/components/PollBody';
import { votePoll } from '@famlin/api-client';

function makePollPost(overrides: Partial<Post> = {}): Post {
  return {
    id: 'post-1',
    authorId: 'u1',
    author: { id: 'u1', name: 'Alice' },
    groupId: 'g1',
    content: 'What should we have for dinner?',
    type: 'POLL',
    uploadedAssetUrls: [],
    createdAt: new Date().toISOString(),
    commentCount: 0,
    likeCount: 0,
    likedByMe: false,
    myReaction: null,
    reactions: {},
    favoritedByMe: false,
    poll: {
      options: [
        { id: 'opt-1', text: 'Pizza', voteCount: 2, voters: [{ id: 'u2', name: 'Bob' }] },
        { id: 'opt-2', text: 'Tacos', voteCount: 1, voters: [{ id: 'u1', name: 'Alice' }] },
      ],
      totalVotes: 3,
      myVoteOptionId: 'opt-2',
      closesAt: null,
      closed: false,
    },
    ...overrides,
  };
}

// Every QueryClient created for a test is disposed in afterEach — react-query
// schedules an unref'd gc setTimeout per cache entry, and clear()'ing it is
// what lets Jest exit promptly instead of waiting out the default gcTime
// (see the same note in utils/__tests__/postCache.test.ts).
const createdQueryClients: QueryClient[] = [];

// @testing-library/react-native's render() is async (it renders under the
// new concurrent-root test-renderer via act()) — every caller must await it.
async function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient();
  createdQueryClients.push(queryClient);
  const result = await render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
  return { ...result, queryClient };
}

describe('PollBody', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    createdQueryClients.splice(0).forEach((client) => client.clear());
  });

  it('renders every option with its text, vote count and percentage', async () => {
    const post = makePollPost();
    const { getByText } = await renderWithClient(<PollBody post={post} />);

    expect(getByText('Pizza')).toBeTruthy();
    expect(getByText('Tacos')).toBeTruthy();
    // 2/3 -> 67%, 1/3 -> 33%
    expect(getByText('2 votes · 67%')).toBeTruthy();
    expect(getByText('1 votes · 33%')).toBeTruthy();
    expect(getByText('3 total votes')).toBeTruthy();
  });

  it('highlights the option the viewer voted for', async () => {
    const post = makePollPost();
    const { getAllByText } = await renderWithClient(<PollBody post={post} />);

    // "Your vote" badge only renders next to the option matching myVoteOptionId.
    expect(getAllByText('Your vote')).toHaveLength(1);
  });

  it('calls votePoll with the post id and tapped option id', async () => {
    const post = makePollPost();
    const { getByTestId } = await renderWithClient(<PollBody post={post} />);

    fireEvent.press(getByTestId('poll-option-opt-1'));

    // useMutation().mutate() dispatches asynchronously, so the mock call
    // doesn't land in the same tick as the press.
    await waitFor(() => expect(votePoll).toHaveBeenCalledWith('post-1', 'opt-1'));
  });

  it('calls votePoll again when tapping my current option (unvote is server-side)', async () => {
    const post = makePollPost();
    const { getByTestId } = await renderWithClient(<PollBody post={post} />);

    fireEvent.press(getByTestId('poll-option-opt-2'));

    await waitFor(() => expect(votePoll).toHaveBeenCalledWith('post-1', 'opt-2'));
  });

  it('renders a closed label and does not vote when the poll is closed', async () => {
    const post = makePollPost({
      poll: {
        options: [
          { id: 'opt-1', text: 'Pizza', voteCount: 2, voters: [] },
          { id: 'opt-2', text: 'Tacos', voteCount: 1, voters: [] },
        ],
        totalVotes: 3,
        myVoteOptionId: null,
        closesAt: new Date(Date.now() - 1000).toISOString(),
        closed: true,
      },
    });
    const { getByText, getByTestId } = await renderWithClient(<PollBody post={post} />);

    expect(getByText('3 total votes · Poll closed')).toBeTruthy();

    fireEvent.press(getByTestId('poll-option-opt-1'));
    expect(votePoll).not.toHaveBeenCalled();
  });

  it('renders nothing when the post has no enriched poll data', async () => {
    const post = makePollPost({ poll: undefined });
    const { toJSON } = await renderWithClient(<PollBody post={post} />);

    expect(toJSON()).toBeNull();
  });
});
