import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Post, votePoll, patchPostInCaches } from '@famlin/api-client';
import { Avatar } from '@/components/Avatar';
import '../PostCard.css';

export function PollCardBody({ post }: { post: Post }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const poll = post.poll;

  // votePoll returns the full shaped + enriched post in one round trip, so
  // there's nothing to compute optimistically — just write the server's
  // answer straight into every cache that might hold this post, the same
  // helper PostCard's reaction/favorite mutations use.
  const voteMutation = useMutation({
    mutationFn: (optionId: string) => votePoll(post.id, optionId),
    onSuccess: (updatedPost) => {
      patchPostInCaches(queryClient, post.id, () => updatedPost);
    },
  });

  if (!poll) return null;

  const disabled = poll.closed || voteMutation.isPending;

  return (
    <div className="poll-body">
      <div className="poll-options">
        {poll.options.map((option) => {
          const pct = poll.totalVotes > 0 ? Math.round((option.voteCount / poll.totalVotes) * 100) : 0;
          const isMine = poll.myVoteOptionId === option.id;
          return (
            <button
              key={option.id}
              type="button"
              className={`poll-option${isMine ? ' poll-option-mine' : ''}`}
              onClick={() => voteMutation.mutate(option.id)}
              disabled={disabled}
              aria-pressed={isMine}
            >
              <span className="poll-option-fill" style={{ width: `${pct}%` }} aria-hidden />
              <span className="poll-option-content">
                <span className="poll-option-row">
                  <span className="poll-option-text">
                    {option.text}
                    {isMine && (
                      <span className="poll-option-mine-badge" title={t('poll.yourVote')} aria-label={t('poll.yourVote')}>
                        ✓
                      </span>
                    )}
                  </span>
                  <span className="poll-option-stats">
                    {poll.totalVotes > 0 && <span className="poll-option-pct">{pct}%</span>}
                    <span className="poll-option-count">{t('poll.votes', { count: option.voteCount })}</span>
                  </span>
                </span>
                {option.voters.length > 0 && (
                  <span className="poll-option-voters">
                    {option.voters.slice(0, 5).map((voter) => (
                      <span key={voter.id} className="poll-voter-avatar">
                        <Avatar name={voter.name} avatarUrl={voter.avatarUrl} size={20} />
                      </span>
                    ))}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
      <div className="poll-footer">
        <span className="poll-total-votes">{t('poll.totalVotes', { count: poll.totalVotes })}</span>
        {poll.closed && <span className="poll-closed-label">{t('poll.closed')}</span>}
      </div>
    </div>
  );
}
