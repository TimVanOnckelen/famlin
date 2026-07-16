import React from 'react';
import { View, Text, StyleSheet, Modal, Pressable, FlatList, ActivityIndicator } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { colors } from '@/constants/colors';
import { Icon } from '@/components/Icon';
import { Avatar } from '@/components/Avatar';
import { REACTION_EMOJI } from '@/constants/reactions';
import { fetchPostReactions, PostReactor } from '@famlin/api-client';

// Who reacted with what, opened by tapping the ReactorStack avatars on a
// post — a bottom sheet rather than the full-screen pickers elsewhere, since
// this is a quick disclosure, not a navigation flow (see ReactionPicker.tsx
// for the same shape used on long-press).
export function ReactionsModal({ postId, onClose }: { postId: string | null; onClose: () => void }) {
  const { t } = useTranslation();

  const { data: reactors, isLoading, isError } = useQuery({
    queryKey: ['postReactions', postId],
    queryFn: () => fetchPostReactions(postId!),
    enabled: postId !== null,
  });

  return (
    <Modal transparent visible={postId !== null} animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.header}>
            <Text style={styles.title}>{t('reactions.title')}</Text>
            <Pressable onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Icon name="x" size={22} color={colors.textMuted} />
            </Pressable>
          </View>

          {isLoading && (
            <View style={styles.centered}>
              <ActivityIndicator color={colors.primary} />
            </View>
          )}

          {isError && (
            <View style={styles.centered}>
              <Text style={styles.errorText}>{t('common.error')}</Text>
            </View>
          )}

          {!isLoading && !isError && (
            <FlatList
              data={reactors ?? []}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.list}
              renderItem={({ item }: { item: PostReactor }) => (
                <View style={styles.row}>
                  <Avatar name={item.name} avatarUrl={item.avatarUrl} size={36} />
                  <Text style={styles.name} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={styles.emoji}>{REACTION_EMOJI[item.type]}</Text>
                </View>
              )}
            />
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '70%',
    paddingBottom: 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 17,
    color: colors.textTitle,
  },
  centered: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  errorText: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 14,
    color: colors.textMuted,
  },
  list: {
    paddingHorizontal: 18,
    paddingTop: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  name: {
    flex: 1,
    fontFamily: 'Nunito_700Bold',
    fontSize: 15,
    color: colors.textTitle,
  },
  emoji: {
    fontSize: 20,
  },
});
