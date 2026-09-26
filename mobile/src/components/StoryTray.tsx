import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Image } from 'expo-image';
import { useNavigation } from '@react-navigation/native';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { fetchStoryHighlights, fetchStoryTray } from '@famlin/api-client';

import { colors } from '@/constants/colors';
import { Avatar } from '@/components/Avatar';
import { Icon } from '@/components/Icon';
import { getUploadUrl } from '@/api/uploads';
import { useAuthStore } from '@/stores/authStore';
import { firstUnseenIndex, traySequences } from '@/utils/stories';

// The feed's story strip: a "your story" bubble to post one, every author
// with a live story (coloured ring while they have something you haven't
// seen), then the group's Highlights — pinned stories as one flat strip,
// newest first. Follows the feed's family filter, and hides entirely when
// none of the selected families has stories turned on.
export function StoryTray({ groupIds, enabled }: { groupIds: string[]; enabled: boolean }) {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const me = useAuthStore((state) => state.user);
  const groupKey = [...groupIds].sort().join(',') || 'all';

  const trayQuery = useQuery({
    queryKey: ['stories', 'tray', groupKey],
    queryFn: () => fetchStoryTray(groupIds),
    enabled,
    refetchInterval: 60_000,
  });
  const highlightsQuery = useInfiniteQuery({
    queryKey: ['stories', 'highlights', groupKey],
    queryFn: ({ pageParam }) => fetchStoryHighlights(groupIds, pageParam ?? undefined),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
  });

  if (!enabled) return null;

  const authors = trayQuery.data?.authors ?? [];
  const highlights = highlightsQuery.data?.pages.flatMap((p) => p.items) ?? [];
  const myIndex = authors.findIndex((a) => a.author.id === me?.id);
  const others = authors.map((entry, index) => ({ entry, index })).filter(({ index }) => index !== myIndex);

  function openAuthor(index: number) {
    const sequences = traySequences(authors);
    navigation.navigate('StoryViewer', {
      sequences,
      startSequence: index,
      startIndex: firstUnseenIndex(sequences[index]),
    });
  }

  function compose() {
    navigation.navigate('StoryComposer', { defaultGroupIds: groupIds });
  }

  return (
    <View style={styles.container}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        <View style={styles.bubble}>
          <TouchableOpacity
            onPress={() => (myIndex >= 0 ? openAuthor(myIndex) : compose())}
            accessibilityLabel={myIndex >= 0 ? t('stories.viewYourStory') : t('stories.addStory')}
          >
            <View style={[styles.ring, myIndex >= 0 && styles.ringSeen]}>
              <Avatar name={me?.name || '?'} avatarUrl={me?.avatarUrl} size={58} />
            </View>
          </TouchableOpacity>
          <TouchableOpacity style={styles.addBadge} onPress={compose} accessibilityLabel={t('stories.addStory')}>
            <Icon name="plus" size={14} color={colors.white} />
          </TouchableOpacity>
          <Text style={styles.name} numberOfLines={1}>
            {t('stories.yourStory')}
          </Text>
        </View>

        {others.map(({ entry, index }) => (
          <TouchableOpacity
            key={entry.author.id}
            style={styles.bubble}
            onPress={() => openAuthor(index)}
            accessibilityLabel={t(entry.hasUnseen ? 'stories.openUnseen' : 'stories.open', { name: entry.author.name })}
          >
            <View style={[styles.ring, entry.hasUnseen ? styles.ringUnseen : styles.ringSeen]}>
              <Avatar name={entry.author.name} avatarUrl={entry.author.avatarUrl} size={58} />
            </View>
            <Text style={styles.name} numberOfLines={1}>
              {entry.author.name.split(' ')[0]}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {highlights.length > 0 && (
        <View style={styles.highlights}>
          <Text style={styles.highlightsTitle}>{t('stories.highlights')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
            {highlights.map((story, i) => (
              <TouchableOpacity
                key={story.id}
                style={styles.highlight}
                onPress={() =>
                  navigation.navigate('StoryViewer', { sequences: [highlights], startSequence: 0, startIndex: i })
                }
                accessibilityLabel={t('stories.openHighlight', { name: story.author.name })}
              >
                <Image source={{ uri: getUploadUrl(story.imageUrl, 'thumbnail') }} style={styles.highlightImage} contentFit="cover" />
              </TouchableOpacity>
            ))}
            {highlightsQuery.hasNextPage && (
              <TouchableOpacity
                style={[styles.highlight, styles.highlightMore]}
                onPress={() => highlightsQuery.fetchNextPage()}
                disabled={highlightsQuery.isFetchingNextPage}
              >
                <Text style={styles.highlightMoreText}>{t('stories.moreHighlights')}</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.white,
    borderRadius: 16,
    paddingVertical: 12,
    marginBottom: 10,
    gap: 10,
  },
  row: {
    paddingHorizontal: 12,
    gap: 12,
  },
  bubble: {
    width: 70,
    alignItems: 'center',
    gap: 4,
  },
  ring: {
    padding: 3,
    borderRadius: 40,
    borderWidth: 2.5,
    borderColor: 'transparent',
  },
  // An unseen author's ring is the warm accent — the one signal the tray
  // exists to give; a seen author's goes quiet.
  ringUnseen: {
    borderColor: colors.accent,
  },
  ringSeen: {
    borderColor: colors.border,
  },
  addBadge: {
    position: 'absolute',
    top: 46,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 12,
    color: colors.textBody,
    maxWidth: 70,
  },
  highlights: {
    gap: 6,
  },
  highlightsTitle: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 12,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.textMuted,
    paddingHorizontal: 12,
  },
  highlight: {
    width: 64,
    height: 96,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: colors.primaryTint,
  },
  highlightImage: {
    width: '100%',
    height: '100%',
  },
  highlightMore: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  highlightMoreText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 12,
    color: colors.primary,
  },
});
