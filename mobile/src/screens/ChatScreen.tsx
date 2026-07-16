import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import * as ImagePicker from 'expo-image-picker';

import { colors } from '@/constants/colors';
import { Icon } from '@/components/Icon';
import { Avatar } from '@/components/Avatar';
import { MediaThumbnail } from '@/components/MediaThumbnail';
import { ReactorStack } from '@/components/ReactorStack';
import { EmptyState } from '@/components/EmptyState';
import {
  ChatMessage,
  fetchChatMessages,
  sendChatMessage,
  markChatRead,
  fetchGroups,
  fetchGroupMembers,
} from '@famlin/api-client';
import { getUploadUrl } from '@/api/uploads';
import { formatRelativeDate } from '@/i18n/utils';
import { useAuthStore } from '@/stores/authStore';
import { useCursorPagination } from '@/hooks/useCursorPagination';
import { usePickAndUploadMedia } from '@/hooks/usePickAndUploadMedia';

// V1 is polling, not a socket — chat should still feel snappier than the
// 30s notification poll, so refetch more often, but only while this screen
// is actually focused (see the useFocusEffect below).
const CHAT_POLL_INTERVAL_MS = 6000;

export function ChatScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { groupId, groupName: routeGroupName } = route.params as { groupId: string; groupName?: string };
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const [text, setText] = useState('');
  const [attachment, setAttachment] = useState<{ uri: string; isVideo: boolean; uploadedUrl?: string } | null>(null);

  // Group name/member count reuse whatever the app already fetches for group
  // info rather than rebuilding it: the groups list (same ['groups'] cache
  // FeedScreen populates) for the name when the caller didn't already pass
  // one, and the members endpoint (same one GroupMembersScreen uses) for the
  // count + header avatar stack.
  const { data: groups } = useQuery({
    queryKey: ['groups'],
    queryFn: fetchGroups,
    enabled: !routeGroupName,
  });
  const groupName = routeGroupName ?? groups?.find((g) => g.id === groupId)?.name ?? '';

  const { data: members } = useQuery({
    queryKey: ['groupMembers', groupId],
    queryFn: () => fetchGroupMembers(groupId),
  });

  const { query, items: messages, onEndReached } = useCursorPagination<ChatMessage>({
    queryKey: ['chatMessages', groupId],
    queryFn: (cursor) => fetchChatMessages(groupId, cursor),
  });
  const { isLoading, isFetchingNextPage, refetch } = query;

  useFocusEffect(
    React.useCallback(() => {
      const interval = setInterval(() => {
        refetch();
      }, CHAT_POLL_INTERVAL_MS);
      return () => clearInterval(interval);
    }, [refetch])
  );

  // Clears the unread badge whenever the chat is opened.
  useFocusEffect(
    React.useCallback(() => {
      markChatRead(groupId)
        .then(() => queryClient.invalidateQueries({ queryKey: ['chat-unread'] }))
        .catch(() => {});
    }, [groupId, queryClient])
  );

  const sendMutation = useMutation({
    mutationFn: (body: { content?: string; attachmentUrl?: string }) => sendChatMessage(groupId, body),
    onSuccess: () => {
      setText('');
      setAttachment(null);
      queryClient.invalidateQueries({ queryKey: ['chatMessages', groupId] });
    },
    onError: (err: any) => {
      Alert.alert(t('common.error'), err.response?.data?.error || err.message || t('chat.sendFailed'));
    },
  });

  // Same pick-then-upload flow as PostDetailScreen's comment attachment.
  const { pick: pickAttachmentMedia, uploading: attachmentUploading } = usePickAndUploadMedia({
    pickerOptions: {
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      quality: 0.8,
      videoMaxDuration: 120,
    },
    onPicked: ([asset]) => setAttachment({ uri: asset.uri, isVideo: asset.isVideo }),
    onError: () => setAttachment(null),
  });

  async function pickAttachment() {
    const result = await pickAttachmentMedia();
    if (!result) return;
    const [asset] = result.assets;
    const [uploadedUrl] = result.urls;
    setAttachment({ uri: asset.uri, isVideo: asset.isVideo, uploadedUrl });
  }

  function handleSend() {
    const trimmed = text.trim();
    if (!trimmed && !attachment?.uploadedUrl) return;
    sendMutation.mutate({ content: trimmed || undefined, attachmentUrl: attachment?.uploadedUrl });
  }

  // The read receipt only ever decorates the current user's single most
  // recent message — messages are newest-first, so the first own-authored
  // item in the list is it. Keep this simple, no per-message tracking.
  const latestOwnMessageId = useMemo(
    () => messages.find((m) => m.authorId === user?.id)?.id,
    [messages, user?.id]
  );

  const canSend = (!!text.trim() || !!attachment?.uploadedUrl) && !attachmentUploading;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
          accessibilityLabel={t('common.back')}
        >
          <Icon name="arrow-left" size={20} color={colors.primary} />
        </TouchableOpacity>
        {!!members && members.length > 0 && <ReactorStack reactors={members} />}
        <View style={styles.headerInfo}>
          <Text style={styles.headerGroupName} numberOfLines={1}>
            {groupName}
          </Text>
          {!!members && (
            <Text style={styles.headerMemberCount}>{t('groupMembers.count', { count: members.length })}</Text>
          )}
        </View>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
        keyboardVerticalOffset={90}
      >
        {isLoading ? (
          <View style={styles.initialLoading}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <FlatList
            data={messages}
            inverted
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            onEndReached={onEndReached}
            onEndReachedThreshold={0.5}
            renderItem={({ item }) => (
              <ChatMessageRow
                message={item}
                isOwn={item.authorId === user?.id}
                showReadReceipt={item.id === latestOwnMessageId && item.readBy.length > 0}
                onPressAttachment={() =>
                  navigation.navigate('ImageViewer', { urls: [getUploadUrl(item.attachmentUrl!)], initialIndex: 0 })
                }
                onPressMilestone={() => {
                  if (item.refPostId) navigation.navigate('PostDetail', { postId: item.refPostId });
                }}
              />
            )}
            ListFooterComponent={
              isFetchingNextPage ? <ActivityIndicator style={styles.loadingMore} color={colors.primary} /> : null
            }
            ListEmptyComponent={<EmptyState title={t('chat.emptyTitle')} subtitle={t('chat.emptySubtitle')} centerSubtitle />}
          />
        )}

        {attachment && (
          <View style={styles.attachmentPreviewRow}>
            <View style={styles.attachmentPreview}>
              <MediaThumbnail url={attachment.uri} style={styles.attachmentPreviewImage} />
              {attachmentUploading && (
                <View style={styles.attachmentUploadingOverlay}>
                  <ActivityIndicator size="small" color={colors.white} />
                </View>
              )}
              <TouchableOpacity
                style={styles.attachmentRemoveButton}
                onPress={() => setAttachment(null)}
                accessibilityLabel={t('postDetail.removeAttachment')}
              >
                <Icon name="x" size={12} color={colors.white} />
              </TouchableOpacity>
            </View>
          </View>
        )}

        <View style={styles.inputContainer}>
          <TouchableOpacity
            style={styles.attachButton}
            onPress={pickAttachment}
            disabled={attachmentUploading}
            accessibilityLabel={t('chat.addAttachment')}
          >
            <Icon name="image" size={18} color={colors.textMuted} />
          </TouchableOpacity>
          <TextInput
            style={styles.input}
            placeholder={t('chat.placeholder')}
            placeholderTextColor={colors.textMuted}
            value={text}
            onChangeText={setText}
            multiline
          />
          <TouchableOpacity
            style={[styles.sendButton, !canSend && styles.sendButtonDisabled]}
            onPress={handleSend}
            disabled={!canSend || sendMutation.isPending}
          >
            <Icon name="send" size={18} color={colors.white} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function ChatMessageRow({
  message,
  isOwn,
  showReadReceipt,
  onPressAttachment,
  onPressMilestone,
}: {
  message: ChatMessage;
  isOwn: boolean;
  showReadReceipt: boolean;
  onPressAttachment: () => void;
  onPressMilestone: () => void;
}) {
  const { t } = useTranslation();

  if (message.kind === 'SYSTEM_MILESTONE') {
    return (
      <View style={styles.milestoneRow}>
        <TouchableOpacity
          style={styles.milestonePill}
          activeOpacity={message.refPostId ? 0.7 : 1}
          disabled={!message.refPostId}
          onPress={onPressMilestone}
        >
          <Text style={styles.milestonePillText}>🎂 {message.content}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.messageRow, isOwn ? styles.messageRowOwn : styles.messageRowOther]}>
      {!isOwn && <Avatar name={message.author.name} avatarUrl={message.author.avatarUrl} size={32} />}
      <View style={[styles.bubbleColumn, isOwn ? styles.bubbleColumnOwn : styles.bubbleColumnOther]}>
        {!isOwn && <Text style={styles.messageAuthor}>{message.author.name}</Text>}
        <View style={[styles.bubble, isOwn ? styles.bubbleOwn : styles.bubbleOther]}>
          {!!message.attachmentUrl && (
            <TouchableOpacity
              activeOpacity={0.9}
              onPress={onPressAttachment}
              accessibilityLabel={t('postDetail.viewAttachment')}
            >
              <MediaThumbnail
                url={getUploadUrl(message.attachmentUrl, 'thumbnail')}
                fallbackUrl={getUploadUrl(message.attachmentUrl)}
                style={styles.attachmentImage}
              />
            </TouchableOpacity>
          )}
          {!!message.content && (
            <Text style={[styles.messageText, isOwn ? styles.messageTextOwn : styles.messageTextOther]}>
              {message.content}
            </Text>
          )}
        </View>
        <Text style={[styles.messageTime, isOwn ? styles.messageTimeOwn : styles.messageTimeOther]}>
          {formatRelativeDate(message.createdAt)}
        </Text>
        {showReadReceipt && (
          <View style={styles.readReceiptRow}>
            <ReactorStack reactors={message.readBy} />
            <Text style={styles.readReceiptLabel}>{t('chat.readBy')}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.white,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerInfo: {
    flex: 1,
  },
  headerGroupName: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 17,
    color: colors.textTitle,
  },
  headerMemberCount: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 1,
  },
  initialLoading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    padding: 14,
    paddingBottom: 10,
    flexGrow: 1,
  },
  loadingMore: {
    marginVertical: 10,
  },
  milestoneRow: {
    alignItems: 'center',
    marginVertical: 10,
  },
  milestonePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.milestone,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 100,
    maxWidth: '85%',
  },
  milestonePillText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 13,
    color: colors.milestoneText,
  },
  messageRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  messageRowOwn: {
    justifyContent: 'flex-end',
  },
  messageRowOther: {
    justifyContent: 'flex-start',
  },
  bubbleColumn: {
    maxWidth: '76%',
  },
  bubbleColumnOwn: {
    alignItems: 'flex-end',
  },
  bubbleColumnOther: {
    alignItems: 'flex-start',
  },
  messageAuthor: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 3,
    marginLeft: 4,
  },
  bubble: {
    borderRadius: 4,
    paddingHorizontal: 13,
    paddingVertical: 10,
    overflow: 'hidden',
  },
  bubbleOwn: {
    backgroundColor: colors.primary,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 4,
  },
  bubbleOther: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderBottomRightRadius: 16,
    borderBottomLeftRadius: 4,
  },
  attachmentImage: {
    width: 200,
    height: 200,
    borderRadius: 12,
    marginBottom: 6,
  },
  messageText: {
    fontFamily: 'Nunito_400Regular',
    fontSize: 15,
    lineHeight: 21,
  },
  messageTextOwn: {
    color: colors.white,
  },
  messageTextOther: {
    color: colors.textBody,
  },
  messageTime: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 3,
  },
  messageTimeOwn: {
    marginRight: 4,
  },
  messageTimeOther: {
    marginLeft: 4,
  },
  readReceiptRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
    marginRight: 4,
  },
  readReceiptLabel: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 11,
    color: colors.textMuted,
  },
  attachmentPreviewRow: {
    backgroundColor: colors.white,
    paddingHorizontal: 14,
    paddingTop: 10,
  },
  attachmentPreview: {
    width: 64,
    height: 64,
    borderRadius: 10,
    overflow: 'hidden',
    position: 'relative',
  },
  attachmentPreviewImage: {
    width: '100%',
    height: '100%',
  },
  attachmentUploadingOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachmentRemoveButton: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputContainer: {
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    paddingBottom: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  input: {
    flex: 1,
    backgroundColor: colors.bg,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 16,
    color: colors.textTitle,
    borderWidth: 1,
    borderColor: colors.border,
    maxHeight: 100,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: colors.border,
  },
});
