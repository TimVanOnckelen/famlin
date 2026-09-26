import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Modal,
  FlatList,
  ActivityIndicator,
  StatusBar,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  REACTION_TYPES,
  ReactionType,
  Story,
  deleteStory,
  fetchStory,
  fetchStoryReactions,
  fetchStoryReplies,
  fetchStoryViews,
  isStoryLive,
  markStoryViewed,
  pinStory,
  reactToStory,
  replyToStory,
  unpinStory,
} from '@famlin/api-client';

import { colors } from '@/constants/colors';
import { REACTION_EMOJI } from '@/constants/reactions';
import { Avatar } from '@/components/Avatar';
import { Icon } from '@/components/Icon';
import { getUploadUrl } from '@/api/uploads';
import { formatRelativeDate } from '@/i18n/utils';
import { nextStoryPosition, previousStoryPosition, StoryPosition } from '@/utils/stories';

export const STORY_DURATION_MS = 5000;
const TICK_MS = 100;

type Params = {
  sequences?: Story[][];
  startSequence?: number;
  startIndex?: number;
  // A notification deep link opens one story by id instead.
  storyId?: string;
};

// Full-screen story player. Plays each run (one per tray author, or the
// whole Highlights strip) in order: tap right/left to skip, hold to pause.
// Viewers can react and send one private reply; the author instead sees who
// viewed/reacted/replied and can pin, unpin or delete.
export function StoryViewerScreen() {
  const route = useRoute<any>();
  const params = (route.params ?? {}) as Params;
  const { t } = useTranslation();

  const singleQuery = useQuery({
    queryKey: ['story', params.storyId],
    queryFn: () => fetchStory(params.storyId!),
    enabled: !!params.storyId && !params.sequences,
  });

  const sequences = params.sequences ?? (singleQuery.data ? [[singleQuery.data]] : null);

  if (!sequences) {
    return (
      <View style={[styles.container, styles.centered]}>
        {singleQuery.isError ? (
          <Text style={styles.goneText}>{t('stories.gone')}</Text>
        ) : (
          <ActivityIndicator color={colors.white} />
        )}
      </View>
    );
  }

  return (
    <StoryPlayer sequences={sequences} start={{ seq: params.startSequence ?? 0, idx: params.startIndex ?? 0 }} />
  );
}

function StoryPlayer({ sequences: initial, start }: { sequences: Story[][]; start: StoryPosition }) {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  // Local copy so deleting a story or reacting updates the player in place.
  const [sequences, setSequences] = useState(initial);
  const [position, setPosition] = useState(start);
  const [elapsed, setElapsed] = useState(0);
  const [holding, setHolding] = useState(false);
  const [typing, setTyping] = useState(false);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [replyText, setReplyText] = useState('');

  const story = sequences[position.seq]?.[position.idx];
  const paused = holding || typing || insightsOpen;

  const close = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['stories'] });
    navigation.goBack();
  }, [navigation, queryClient]);

  const goNext = useCallback(() => {
    setElapsed(0);
    const next = nextStoryPosition(sequences, position);
    if (next) setPosition(next);
    else close();
  }, [sequences, position, close]);

  const goPrev = useCallback(() => {
    setElapsed(0);
    setPosition(previousStoryPosition(sequences, position));
  }, [sequences, position]);

  const viewed = useRef(new Set<string>());
  useEffect(() => {
    if (!story || viewed.current.has(story.id)) return;
    viewed.current.add(story.id);
    // The server ignores this for your own story and an expired Highlight.
    markStoryViewed(story.id).catch(() => {});
  }, [story]);

  useEffect(() => {
    if (paused || !story) return;
    const timer = setInterval(() => setElapsed((e) => e + TICK_MS), TICK_MS);
    return () => clearInterval(timer);
  }, [paused, story]);

  useEffect(() => {
    if (elapsed >= STORY_DURATION_MS) goNext();
  }, [elapsed, goNext]);

  function patchStory(id: string, patch: Partial<Story>) {
    setSequences((seqs) => seqs.map((run) => run.map((s) => (s.id === id ? { ...s, ...patch } : s))));
  }

  function dropStory(id: string) {
    const remaining = sequences.map((run) => run.filter((s) => s.id !== id)).filter((run) => run.length > 0);
    if (remaining.length === 0) return close();
    setSequences(remaining);
    setElapsed(0);
    setPosition((p) => {
      const seq = Math.min(p.seq, remaining.length - 1);
      return { seq, idx: Math.min(p.idx, remaining[seq].length - 1) };
    });
  }

  const react = useMutation({
    mutationFn: ({ id, type }: { id: string; type: ReactionType }) => reactToStory(id, type),
    onSuccess: ({ myReaction }, { id }) => patchStory(id, { myReaction }),
  });

  const reply = useMutation({
    mutationFn: ({ id, content }: { id: string; content: string }) => replyToStory(id, content),
    onSuccess: (sent, { id }) => {
      patchStory(id, { myReply: sent });
      setReplyText('');
      setTyping(false);
    },
    onError: () => Alert.alert(t('stories.replyFailed')),
  });

  const pin = useMutation({
    mutationFn: ({ id, pinned }: { id: string; pinned: boolean }) => (pinned ? unpinStory(id) : pinStory(id)),
    onSuccess: (result, { id }) => {
      if (result.deleted) dropStory(id);
      else patchStory(id, { pinnedAt: result.pinnedAt });
    },
    onError: () => Alert.alert(t('common.error'), t('stories.actionFailed')),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteStory(id),
    onSuccess: (_r, id) => dropStory(id),
    onError: () => Alert.alert(t('common.error'), t('stories.actionFailed')),
  });

  if (!story) return null;

  const live = isStoryLive(story);
  const run = sequences[position.seq] ?? [];
  const progress = Math.min(1, elapsed / STORY_DURATION_MS);

  function togglePin() {
    if (!story) return;
    const pinned = !!story.pinnedAt;
    // Unpinning an expired Highlight has nothing to fall back to — it deletes.
    if (pinned && !live) {
      setHolding(true);
      Alert.alert(t('stories.unpinDeleteTitle'), t('stories.unpinDeleteMessage'), [
        { text: t('common.cancel'), style: 'cancel', onPress: () => setHolding(false) },
        {
          text: t('stories.delete'),
          style: 'destructive',
          onPress: () => {
            setHolding(false);
            pin.mutate({ id: story.id, pinned });
          },
        },
      ]);
      return;
    }
    pin.mutate({ id: story.id, pinned });
  }

  function confirmDelete() {
    if (!story) return;
    setHolding(true);
    Alert.alert(t('stories.deleteTitle'), t('stories.deleteMessage'), [
      { text: t('common.cancel'), style: 'cancel', onPress: () => setHolding(false) },
      {
        text: t('stories.delete'),
        style: 'destructive',
        onPress: () => {
          setHolding(false);
          remove.mutate(story.id);
        },
      },
    ]);
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <Image source={{ uri: getUploadUrl(story.imageUrl) }} style={StyleSheet.absoluteFill} contentFit="contain" />

      <Pressable
        style={[styles.tapZone, styles.tapPrev]}
        onPress={goPrev}
        onLongPress={() => setHolding(true)}
        onPressOut={() => setHolding(false)}
        accessibilityLabel={t('stories.previous')}
      />
      <Pressable
        style={[styles.tapZone, styles.tapNext]}
        onPress={goNext}
        onLongPress={() => setHolding(true)}
        onPressOut={() => setHolding(false)}
        accessibilityLabel={t('stories.next')}
      />

      <SafeAreaView style={styles.overlay} pointerEvents="box-none">
        <View style={styles.progressRow}>
          {run.map((item, i) => (
            <View key={item.id} style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${i < position.idx ? 100 : i === position.idx ? progress * 100 : 0}%` },
                ]}
              />
            </View>
          ))}
        </View>

        <View style={styles.header}>
          <Avatar name={story.author.name} avatarUrl={story.author.avatarUrl} size={36} />
          <View style={styles.headerText}>
            <Text style={styles.authorName} numberOfLines={1}>
              {story.author.name}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              {formatRelativeDate(story.createdAt)} · {story.circle?.name ?? story.group.name}
              {story.pinnedAt ? ` · ${t('stories.highlightBadge')}` : ''}
            </Text>
          </View>
          <TouchableOpacity onPress={close} style={styles.iconButton} accessibilityLabel={t('common.close')}>
            <Icon name="x" size={26} color={colors.white} />
          </TouchableOpacity>
        </View>

        <View style={{ flex: 1 }} pointerEvents="none" />

        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {story.isMine ? (
            <View style={styles.authorBar}>
              <TouchableOpacity style={styles.pill} onPress={() => setInsightsOpen(true)}>
                <Icon name="eye" size={16} color={colors.white} />
                <Text style={styles.pillText}>
                  {t('stories.seenBy', { count: story.stats?.viewCount ?? 0 })}
                  {(story.stats?.replyCount ?? 0) > 0
                    ? ` · ${t('stories.repliesCount', { count: story.stats!.replyCount })}`
                    : ''}
                </Text>
              </TouchableOpacity>
              {(live || story.pinnedAt) && (
                <TouchableOpacity
                  style={styles.iconButton}
                  onPress={togglePin}
                  disabled={pin.isPending}
                  accessibilityLabel={story.pinnedAt ? t('stories.unpin') : t('stories.pin')}
                >
                  <Icon name="bookmark" size={22} color={story.pinnedAt ? colors.milestone : colors.white} />
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={styles.iconButton}
                onPress={confirmDelete}
                disabled={remove.isPending}
                accessibilityLabel={t('stories.delete')}
              >
                <Icon name="trash-2" size={22} color={colors.white} />
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.viewerBar}>
              <View style={styles.reactions}>
                {REACTION_TYPES.map((type) => (
                  <TouchableOpacity
                    key={type}
                    style={[styles.reaction, story.myReaction === type && styles.reactionActive]}
                    onPress={() => react.mutate({ id: story.id, type })}
                    disabled={react.isPending}
                    accessibilityLabel={t(`stories.reactions.${type}` as any)}
                    accessibilityState={{ selected: story.myReaction === type }}
                  >
                    <Text style={styles.reactionEmoji}>{REACTION_EMOJI[type]}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {story.myReply ? (
                <Text style={styles.replied}>{t('stories.youReplied', { content: story.myReply.content })}</Text>
              ) : live ? (
                <View style={styles.replyRow}>
                  <TextInput
                    style={styles.replyInput}
                    value={replyText}
                    onChangeText={setReplyText}
                    onFocus={() => setTyping(true)}
                    onBlur={() => setTyping(false)}
                    placeholder={t('stories.replyPlaceholder', { name: story.author.name })}
                    placeholderTextColor="rgba(255,255,255,0.75)"
                    maxLength={500}
                    returnKeyType="send"
                    onSubmitEditing={() => replyText.trim() && reply.mutate({ id: story.id, content: replyText.trim() })}
                  />
                  <TouchableOpacity
                    style={styles.iconButton}
                    disabled={!replyText.trim() || reply.isPending}
                    onPress={() => reply.mutate({ id: story.id, content: replyText.trim() })}
                    accessibilityLabel={t('stories.sendReply')}
                  >
                    <Icon name="send" size={22} color={replyText.trim() ? colors.white : 'rgba(255,255,255,0.4)'} />
                  </TouchableOpacity>
                </View>
              ) : null}
            </View>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>

      {story.isMine && (
        <StoryInsightsSheet storyId={story.id} visible={insightsOpen} onClose={() => setInsightsOpen(false)} />
      )}
    </View>
  );
}

// Author-only: who viewed, who reacted with what, and the private replies.
function StoryInsightsSheet({ storyId, visible, onClose }: { storyId: string; visible: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'views' | 'reactions' | 'replies'>('views');

  const views = useQuery({ queryKey: ['story-views', storyId], queryFn: () => fetchStoryViews(storyId), enabled: visible });
  const reactions = useQuery({
    queryKey: ['story-reactions', storyId],
    queryFn: () => fetchStoryReactions(storyId),
    enabled: visible,
  });
  const replies = useQuery({
    queryKey: ['story-replies', storyId],
    queryFn: () => fetchStoryReplies(storyId),
    enabled: visible,
  });

  const rows: { id: string; name: string; avatarUrl: string | null; detail: string }[] =
    tab === 'views'
      ? (views.data ?? []).map((v) => ({ ...v, detail: formatRelativeDate(v.viewedAt) }))
      : tab === 'reactions'
        ? (reactions.data ?? []).map((r) => ({ ...r, detail: REACTION_EMOJI[r.type] }))
        : (replies.data ?? []).map((r) => ({ ...r.fromUser, id: r.id, detail: r.content }));

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.sheetTabs}>
          {(['views', 'reactions', 'replies'] as const).map((key) => (
            <TouchableOpacity
              key={key}
              style={[styles.sheetTab, tab === key && styles.sheetTabActive]}
              onPress={() => setTab(key)}
              accessibilityState={{ selected: tab === key }}
            >
              <Text style={[styles.sheetTabText, tab === key && styles.sheetTabTextActive]}>
                {t(`stories.tabs.${key}` as any)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <FlatList
          data={rows}
          keyExtractor={(row) => row.id}
          renderItem={({ item }) => (
            <View style={styles.sheetRow}>
              <Avatar name={item.name} avatarUrl={item.avatarUrl} size={34} />
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetName}>{item.name}</Text>
                {tab === 'replies' && <Text style={styles.sheetReply}>{item.detail}</Text>}
              </View>
              {tab !== 'replies' && <Text style={styles.sheetDetail}>{item.detail}</Text>}
            </View>
          )}
          ListEmptyComponent={
            <Text style={styles.sheetEmpty}>
              {t(tab === 'views' ? 'stories.noViews' : tab === 'reactions' ? 'stories.noReactions' : 'stories.noReplies')}
            </Text>
          }
        />
        <Text style={styles.sheetPrivacy}>{t('stories.repliesPrivate')}</Text>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  goneText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 16,
    color: colors.white,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  tapZone: {
    position: 'absolute',
    top: 90,
    bottom: 160,
    width: '35%',
  },
  tapPrev: {
    left: 0,
  },
  tapNext: {
    right: 0,
  },
  progressRow: {
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 10,
    paddingTop: 8,
  },
  progressTrack: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.35)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.white,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  headerText: {
    flex: 1,
  },
  authorName: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 15,
    color: colors.white,
  },
  meta: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 12,
    color: 'rgba(255,255,255,0.85)',
  },
  iconButton: {
    padding: 8,
  },
  authorBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 14,
  },
  pill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderRadius: 100,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  pillText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 14,
    color: colors.white,
  },
  viewerBar: {
    padding: 14,
    gap: 10,
  },
  reactions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  reaction: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  reactionActive: {
    borderColor: colors.white,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  reactionEmoji: {
    fontSize: 22,
  },
  replyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  replyInput: {
    flex: 1,
    borderRadius: 100,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.6)',
    backgroundColor: 'rgba(0,0,0,0.25)',
    color: colors.white,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 15,
  },
  replied: {
    textAlign: 'center',
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 14,
    color: colors.white,
  },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  sheet: {
    maxHeight: '60%',
    backgroundColor: colors.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    paddingBottom: 32,
    gap: 10,
  },
  sheetTabs: {
    flexDirection: 'row',
    gap: 6,
  },
  sheetTab: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 100,
  },
  sheetTabActive: {
    backgroundColor: colors.primaryTint,
  },
  sheetTabText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 14,
    color: colors.textMuted,
  },
  sheetTabTextActive: {
    color: colors.primaryDark,
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
  },
  sheetName: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 15,
    color: colors.textTitle,
  },
  sheetReply: {
    fontFamily: 'Nunito_400Regular',
    fontSize: 14,
    color: colors.textBody,
  },
  sheetDetail: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 13,
    color: colors.textMuted,
  },
  sheetEmpty: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 14,
    color: colors.textMuted,
    paddingVertical: 12,
  },
  sheetPrivacy: {
    fontFamily: 'Nunito_400Regular',
    fontSize: 12,
    color: colors.textMuted,
  },
});
