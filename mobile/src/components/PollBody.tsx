import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { colors } from '@/constants/colors';
import { Avatar } from '@/components/Avatar';
import { Post } from '@/types';
import { votePoll } from '@famlin/api-client';
import { patchPostInCaches } from '@/utils/postCache';

const MAX_VOTER_AVATARS = 3;

// Shared poll rendering used by both PostCard (feed) and PostDetailScreen —
// the question itself is `post.content`, already rendered by the caller as
// the post's normal content; this only renders the options underneath it.
// See postTypes/index.ts for how PostCard picks this up via the renderer
// registry, and CLAUDE.md's PostTypeHandler notes for the server-side shape
// (`poll` is the read-time-enriched view of `typeData`, see services/postTypes/poll.ts).
export function PollBody({ post }: { post: Post }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const poll = post.poll;

  const voteMutation = useMutation({
    mutationFn: (optionId: string) => votePoll(post.id, optionId),
    onSuccess: (updatedPost) => {
      // The interactions endpoint returns the full shaped + enriched post —
      // simplest correct thing is to just replace the cached post with it
      // (no optimistic patch: computing the new voter list/order client-side
      // isn't worth the duplicated aggregation logic the server already does).
      patchPostInCaches(queryClient, post.id, () => updatedPost);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['posts'] });
      queryClient.invalidateQueries({ queryKey: ['post', post.id] });
    },
  });

  if (!poll) return null;

  function handleVote(optionId: string) {
    if (poll!.closed || voteMutation.isPending) return;
    // Tapping the option I already voted for unvotes (mirrors reactions).
    voteMutation.mutate(optionId);
  }

  return (
    <View style={styles.container}>
      {poll.options.map((option) => {
        const percentage = poll.totalVotes > 0 ? Math.round((option.voteCount / poll.totalVotes) * 100) : 0;
        const isMine = poll.myVoteOptionId === option.id;
        return (
          <TouchableOpacity
            key={option.id}
            testID={`poll-option-${option.id}`}
            style={[styles.optionRow, isMine && styles.optionRowActive]}
            onPress={() => handleVote(option.id)}
            disabled={poll.closed || voteMutation.isPending}
            accessibilityRole="button"
            accessibilityState={{ selected: isMine, disabled: poll.closed }}
            accessibilityLabel={`${t('poll.vote')}: ${option.text}`}
          >
            <View
              style={[styles.fillBar, { width: `${percentage}%` }, isMine && styles.fillBarActive]}
              pointerEvents="none"
            />
            <View style={styles.optionContent}>
              <View style={styles.optionTextRow}>
                <Text style={[styles.optionText, isMine && styles.optionTextActive]} numberOfLines={2}>
                  {option.text}
                </Text>
                {isMine && <Text style={styles.myVoteBadge}>{t('poll.myVote')}</Text>}
              </View>
              <View style={styles.optionMetaRow}>
                <Text style={styles.optionCount}>
                  {t('poll.votes', { count: option.voteCount })} · {percentage}%
                </Text>
                {option.voters.length > 0 && (
                  <View style={styles.votersStack}>
                    {option.voters.slice(0, MAX_VOTER_AVATARS).map((voter, index) => (
                      <View key={voter.id} style={[styles.voterFace, index > 0 && styles.voterFaceOverlap]}>
                        <Avatar name={voter.name} avatarUrl={voter.avatarUrl} size={20} />
                      </View>
                    ))}
                  </View>
                )}
              </View>
            </View>
          </TouchableOpacity>
        );
      })}
      <Text style={styles.totalVotes}>
        {t('poll.totalVotes', { count: poll.totalVotes })}
        {poll.closed ? ` · ${t('poll.closed')}` : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 8,
    marginBottom: 4,
    gap: 8,
  },
  optionRow: {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  optionRowActive: {
    borderColor: colors.primary,
  },
  fillBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    backgroundColor: colors.primaryTint,
  },
  fillBarActive: {
    backgroundColor: colors.primaryTint,
  },
  optionContent: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  optionTextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  optionText: {
    flex: 1,
    fontFamily: 'Nunito_700Bold',
    fontSize: 15,
    color: colors.textTitle,
  },
  optionTextActive: {
    color: colors.primaryDark,
  },
  myVoteBadge: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 10,
    color: colors.white,
    backgroundColor: colors.primary,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 100,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  optionMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  optionCount: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 12,
    color: colors.textMuted,
  },
  votersStack: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  voterFace: {
    borderWidth: 2,
    borderColor: colors.white,
    borderRadius: 11,
  },
  voterFaceOverlap: {
    marginLeft: -6,
  },
  totalVotes: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
});
