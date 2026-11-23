import React from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation, useRoute } from '@react-navigation/native'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  chatConversationsQueryKey,
  chatMessagesQueryKey,
  chatUnreadConversationsQueryKey,
  deleteChatMessage,
  fetchChatConversations,
  isChatEncryptionSupported,
  sendChatConversationMessage,
  type ChatConversationMessage,
} from '@famlin/api-client'

import { colors } from '@/constants/colors'
import { Avatar } from '@/components/Avatar'
import { ChatComposer } from '@/components/ChatComposer'
import { EmptyState } from '@/components/EmptyState'
import { Icon } from '@/components/Icon'
import { MediaThumbnail } from '@/components/MediaThumbnail'
import { useChatConversationMessages } from '@/hooks/useChatConversationMessages'
import { useAuthStore } from '@/stores/authStore'
import { getUploadUrl } from '@/api/uploads'
import { formatRelativeDate } from '@/i18n/utils'
import { chatConversationTitle } from '@/utils/chatConversations'
import { removeChatMessageFromCache } from '@/utils/chatCache'

export function DirectMessageScreen() {
  const { t } = useTranslation()
  const navigation = useNavigation<any>()
  const { conversationId } = useRoute<any>().params as { conversationId: string }
  const queryClient = useQueryClient()
  const userId = useAuthStore((state) => state.user?.id)
  const conversationsQuery = useQuery({
    queryKey: chatConversationsQueryKey(),
    queryFn: fetchChatConversations,
  })
  const conversation = conversationsQuery.data?.items.find((item) => item.id === conversationId)
  const title = conversation ? chatConversationTitle(conversation, userId) : ''
  const participant = conversation?.participants.find((item) => item.id !== userId)
  const { query, items, onEndReached, unavailable } = useChatConversationMessages({
    conversationId: conversation ? conversationId : '',
    modern: true,
  })

  const deleteMutation = useMutation({
    mutationFn: (messageId: string) => deleteChatMessage(messageId),
    onSuccess: (_data, messageId) => {
      removeChatMessageFromCache(queryClient, conversationId, messageId)
      void queryClient.invalidateQueries({ queryKey: chatConversationsQueryKey() })
      void queryClient.invalidateQueries({ queryKey: chatUnreadConversationsQueryKey() })
    },
  })

  function confirmDelete(message: ChatConversationMessage) {
    Alert.alert(t('chat.deleteMessageTitle'), t('chat.deleteMessageConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('chat.delete'),
        style: 'destructive',
        onPress: () =>
          deleteMutation.mutate(message.id, {
            onError: (error: any) =>
              Alert.alert(t('common.error'), error.response?.data?.error || error.message || t('common.tryAgain')),
          }),
      },
    ])
  }

  async function send(body: { content?: string; attachmentUrl?: string }) {
    const created = await sendChatConversationMessage(conversationId, body)
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: chatMessagesQueryKey(conversationId) }),
      queryClient.invalidateQueries({ queryKey: chatConversationsQueryKey() }),
    ])
    return created
  }

  const stale = conversationsQuery.isFetched && conversationsQuery.data !== undefined && !conversation
  if (stale || unavailable) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.unavailableHeader}>
          <TouchableOpacity
            style={styles.back}
            onPress={() => navigation.goBack()}
            accessibilityLabel={t('common.back')}
          >
            <Icon name="arrow-left" size={20} color={colors.primary} />
          </TouchableOpacity>
        </View>
        <EmptyState
          title={t('chat.conversationUnavailable')}
          subtitle={t('chat.conversationUnavailableSubtitle')}
          centerSubtitle
        />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.back} onPress={() => navigation.goBack()} accessibilityLabel={t('common.back')}>
          <Icon name="arrow-left" size={20} color={colors.primary} />
        </TouchableOpacity>
        {!!title && <Avatar name={title} avatarUrl={participant?.avatarUrl ?? null} size={38} />}
        <Text style={styles.headerTitle} numberOfLines={1}>
          {title}
        </Text>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={90}
      >
        {conversationsQuery.isLoading || query.isLoading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <FlatList
            data={items as ChatConversationMessage[]}
            inverted
            maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            onEndReached={onEndReached}
            onEndReachedThreshold={0.5}
            renderItem={({ item }) => (
              <DirectMessageRow
                message={item}
                isOwn={item.authorId === userId}
                onDelete={() => confirmDelete(item)}
                onPressAttachment={() =>
                  navigation.navigate('ImageViewer', {
                    urls: [getUploadUrl(item.attachmentUrl!)],
                    initialIndex: 0,
                  })
                }
              />
            )}
            ListFooterComponent={
              query.isFetchingNextPage ? (
                <ActivityIndicator color={colors.primary} style={styles.loadingMore} />
              ) : undefined
            }
            ListEmptyComponent={
              <EmptyState title={t('chat.emptyTitle')} subtitle={t('chat.emptySubtitle')} centerSubtitle />
            }
          />
        )}
        <ChatComposer send={send} />
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

function DirectMessageRow({
  message,
  isOwn,
  onDelete,
  onPressAttachment,
}: {
  message: ChatConversationMessage
  isOwn: boolean
  onDelete: () => void
  onPressAttachment: () => void
}) {
  const { t } = useTranslation()
  const supported = isChatEncryptionSupported(message.encryption)
  return (
    <View style={[styles.messageRow, isOwn ? styles.messageRowOwn : styles.messageRowOther]}>
      <View style={[styles.bubble, isOwn ? styles.ownBubble : styles.otherBubble]}>
        {!supported ? (
          <Text style={[styles.messageText, isOwn && styles.ownMessageText]}>{t('chat.unsupportedEncryption')}</Text>
        ) : (
          <>
            {!!message.attachmentUrl && (
              <TouchableOpacity onPress={onPressAttachment} accessibilityLabel={t('postDetail.viewAttachment')}>
                <MediaThumbnail
                  url={getUploadUrl(message.attachmentUrl, 'thumbnail')}
                  fallbackUrl={getUploadUrl(message.attachmentUrl)}
                  style={styles.attachment}
                />
              </TouchableOpacity>
            )}
            {!!message.content && (
              <Text style={[styles.messageText, isOwn && styles.ownMessageText]}>{message.content}</Text>
            )}
          </>
        )}
        {isOwn && (
          <TouchableOpacity style={styles.delete} onPress={onDelete} accessibilityLabel={t('chat.deleteMessage')}>
            <Icon name="trash-2" size={14} color={isOwn ? colors.white : colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>
      <Text style={[styles.time, isOwn && styles.timeOwn]}>{formatRelativeDate(message.createdAt)}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  unavailableHeader: { padding: 12, backgroundColor: colors.white },
  back: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, color: colors.textTitle, fontFamily: 'Nunito_700Bold', fontSize: 17 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 16, gap: 10, flexGrow: 1 },
  loadingMore: { marginVertical: 10 },
  messageRow: { maxWidth: '82%', gap: 3 },
  messageRowOwn: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  messageRowOther: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  bubble: { minWidth: 54, borderRadius: 18, paddingHorizontal: 13, paddingVertical: 9 },
  ownBubble: { backgroundColor: colors.primary, borderBottomRightRadius: 6 },
  otherBubble: { backgroundColor: colors.white, borderBottomLeftRadius: 6 },
  messageText: { color: colors.textBody, fontFamily: 'Nunito_400Regular', fontSize: 15, lineHeight: 20 },
  ownMessageText: { color: colors.white },
  attachment: { width: 220, height: 220, borderRadius: 12, marginBottom: 6, overflow: 'hidden' },
  time: { color: colors.textMuted, fontFamily: 'Nunito_400Regular', fontSize: 11 },
  timeOwn: { paddingRight: 4 },
  delete: { alignSelf: 'flex-end', marginTop: 5 },
})
