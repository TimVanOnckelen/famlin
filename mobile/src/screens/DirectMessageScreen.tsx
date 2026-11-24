import React, { useEffect, useRef, useState } from 'react'
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
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated'
import {
  chatConversationsQueryKey,
  chatMessagesQueryKey,
  chatUnreadConversationsQueryKey,
  deleteChatMessage,
  fetchChatConversations,
  isChatEncryptionSupported,
  sendChatConversationMessage,
  setChatConversationEncryption,
  type ChatConversationMessage,
} from '@famlin/api-client'

import { colors } from '@/constants/colors'
import { Avatar } from '@/components/Avatar'
import { ChatComposer } from '@/components/ChatComposer'
import { EmptyState } from '@/components/EmptyState'
import { E2eNotice } from '@/components/E2eNotice'
import { EncryptedPhoto } from '@/components/EncryptedPhoto'
import { Icon } from '@/components/Icon'
import { MediaThumbnail } from '@/components/MediaThumbnail'
import { useChatConversationMessages } from '@/hooks/useChatConversationMessages'
import type { ComposerSendBody } from '@/hooks/useChatMessageComposer'
import { useAuthStore } from '@/stores/authStore'
import { getUploadUrl } from '@/api/uploads'
import { formatRelativeDate } from '@/i18n/utils'
import { isVideoUrl } from '@/utils/media'
import { chatConversationTitle } from '@/utils/chatConversations'
import { removeChatMessageFromCache } from '@/utils/chatCache'
import { useDmCrypto, type DmRow } from '@/e2e/useDmCrypto'
import { sendEncryptedMessage } from '@/e2e/send'
import { decryptErrorKey } from '@/e2e/decrypt'
import { getCachedContent } from '@/e2e/cache'
import { useE2eKeysStore } from '@/e2e/keysStore'

const MAX_SWIPE_TRANSLATION = 60
const SWIPE_REPLY_THRESHOLD_RATIO = 0.35

export function DirectMessageScreen() {
  const { t } = useTranslation()
  const navigation = useNavigation<any>()
  const { conversationId } = useRoute<any>().params as { conversationId: string }
  const queryClient = useQueryClient()
  const userId = useAuthStore((state) => state.user?.id)
  const [replyTarget, setReplyTarget] = useState<ChatConversationMessage | null>(null)
  const flatListRef = useRef<FlatList<DmRow>>(null)
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
  const crypto = useDmCrypto(conversation, items as ChatConversationMessage[])
  const { e2e, decision, rows } = crypto
  const e2eActive = e2e.status !== 'unsupported'

  const deleteMutation = useMutation({
    mutationFn: (messageId: string) => deleteChatMessage(messageId),
    onSuccess: (_data, messageId) => {
      removeChatMessageFromCache(queryClient, conversationId, messageId)
      void queryClient.invalidateQueries({ queryKey: chatConversationsQueryKey() })
      void queryClient.invalidateQueries({ queryKey: chatUnreadConversationsQueryKey() })
    },
  })

  const encryptionMutation = useMutation({
    mutationFn: (enabled: boolean) => setChatConversationEncryption(conversationId, enabled),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: chatConversationsQueryKey() }),
        queryClient.invalidateQueries({ queryKey: chatMessagesQueryKey(conversationId) }),
      ]),
    onError: (error: any) =>
      Alert.alert(t('common.error'), error.response?.data?.error || error.message || t('common.tryAgain')),
  })

  function confirmTurnOff() {
    Alert.alert(t('e2e.turnOffTitle'), t('e2e.turnOffConfirm', { name: title }), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('e2e.turnOff'), style: 'destructive', onPress: () => encryptionMutation.mutate(false) },
    ])
  }

  function openMenu() {
    const off = !!conversation?.encryptionDisabledAt
    Alert.alert(title, undefined, [
      { text: t('e2e.safetyCode.menu'), onPress: () => navigation.navigate('SafetyCode', { conversationId }) },
      off
        ? { text: t('e2e.turnOn'), onPress: () => encryptionMutation.mutate(true) }
        : { text: t('e2e.turnOff'), style: 'destructive', onPress: confirmTurnOff },
      { text: t('common.cancel'), style: 'cancel' },
    ])
  }

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

  async function send(body: ComposerSendBody) {
    const replyToMessageId = replyTarget?.id
    let created
    if (decision.kind === 'wait') throw new Error(t('e2e.stillChecking'))
    if (decision.kind === 'encrypt' && e2e.latestKeys && crypto.peerId) {
      created = await sendEncryptedMessage({
        queryClient,
        conversationId,
        sender: e2e.latestKeys,
        peerId: crypto.peerId,
        text: body.content,
        photo: body.localPhoto,
        replyToMessageId,
      })
      void useE2eKeysStore.getState().noteEncryptedSend()
    } else {
      created = await sendChatConversationMessage(conversationId, {
        ...(body.content ? { content: body.content } : {}),
        ...(body.attachmentUrl ? { attachmentUrl: body.attachmentUrl } : {}),
        ...(replyToMessageId ? { replyToMessageId } : {}),
      })
    }
    setReplyTarget(null)
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: chatMessagesQueryKey(conversationId) }),
      queryClient.invalidateQueries({ queryKey: chatConversationsQueryKey() }),
    ])
    return created
  }

  function handleJumpToOriginal(messageId: string) {
    const index = rows.findIndex((row) => row.message.id === messageId)
    if (index === -1) return
    try {
      flatListRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true })
    } catch {
      // The failure callback provides the approximate offset for unmeasured rows.
    }
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

  const encrypting = decision.kind === 'encrypt'
  const replySnippet = replyTarget ? replySnippetOf(replyTarget, t) : ''

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
        {e2eActive && (
          <>
            {crypto.verified && <Icon name="shield" size={18} color={colors.primary} />}
            <TouchableOpacity style={styles.back} onPress={openMenu} accessibilityLabel={t('e2e.conversationMenu')}>
              <Icon
                name={encrypting ? 'lock' : 'unlock'}
                size={18}
                color={encrypting ? colors.primary : colors.textMuted}
              />
            </TouchableOpacity>
          </>
        )}
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
            ref={flatListRef}
            data={rows}
            inverted
            maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
            keyExtractor={(item) => item.message.id}
            contentContainerStyle={styles.list}
            onEndReached={onEndReached}
            onEndReachedThreshold={0.5}
            onScrollToIndexFailed={({ index, averageItemLength }) => {
              flatListRef.current?.scrollToOffset({ offset: averageItemLength * index, animated: true })
            }}
            renderItem={({ item }) =>
              item.kind === 'system' ? (
                <SystemRow row={item} />
              ) : (
                <DirectMessageRow
                  row={item}
                  isOwn={item.message.authorId === userId}
                  showState={e2eActive}
                  hasKeys={e2e.myKeys.length > 0}
                  onSwipeToReply={setReplyTarget}
                  onPressReplyQuote={handleJumpToOriginal}
                  onDelete={() => confirmDelete(item.message)}
                  onRestore={() => navigation.navigate('E2eRestore')}
                  onPressAttachment={(uri) =>
                    navigation.navigate('ImageViewer', {
                      urls: [uri ?? getUploadUrl(item.message.attachmentUrl!)],
                      initialIndex: 0,
                    })
                  }
                />
              )
            }
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
        {replyTarget && (
          <View style={styles.replyPreviewRow}>
            <View style={styles.replyPreviewBar} />
            <View style={styles.replyPreviewTextWrap}>
              <Text style={styles.replyPreviewAuthor} numberOfLines={1}>
                {t('chat.replyingTo', { name: replyTarget.author.name })}
              </Text>
              <Text style={styles.replyPreviewSnippet} numberOfLines={1}>
                {replySnippet}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.replyPreviewCancel}
              onPress={() => setReplyTarget(null)}
              accessibilityLabel={t('chat.cancelReply')}
            >
              <Icon name="x" size={14} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        )}
        {crypto.keyChanged && (
          <E2eNotice
            icon="alert-circle"
            tone="warning"
            message={t('e2e.keyChanged', { name: title })}
            actions={[
              { label: t('e2e.verify'), onPress: () => navigation.navigate('SafetyCode', { conversationId }) },
              { label: t('e2e.dismiss'), onPress: crypto.dismissKeyChange },
            ]}
          />
        )}
        {decision.kind === 'plaintext' && decision.reason !== 'unsupported' && (
          <PlaintextBanner
            reason={decision.reason}
            name={title}
            onTurnOn={() => encryptionMutation.mutate(true)}
            onRestore={() => navigation.navigate('E2eRestore')}
          />
        )}
        {decision.kind === 'wait' && <E2eNotice icon="lock" message={t('e2e.stillChecking')} />}
        {encrypting && <E2eNotice icon="lock" message={t('e2e.banner.encrypted')} />}
        <ChatComposer send={send} encrypted={encrypting} disabled={decision.kind === 'wait'} />
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

function replySnippetOf(message: ChatConversationMessage, t: (key: string) => string): string {
  if (message.encryption !== 'none') {
    const content = getCachedContent(message.id)
    if (content?.text) return content.text
    return content?.attachment ? t('chat.attachmentPhoto') : t('e2e.encryptedMessage')
  }
  return (
    message.content ??
    (message.attachmentUrl && isVideoUrl(message.attachmentUrl) ? t('chat.attachmentVideo') : t('chat.attachmentPhoto'))
  )
}

function PlaintextBanner({
  reason,
  name,
  onTurnOn,
  onRestore,
}: {
  reason: 'disabled' | 'peerNoKey' | 'needsSetup' | 'needsRestore'
  name: string
  onTurnOn: () => void
  onRestore: () => void
}) {
  const { t } = useTranslation()
  const actions =
    reason === 'disabled'
      ? [{ label: t('e2e.turnOn'), onPress: onTurnOn }]
      : reason === 'needsRestore'
        ? [{ label: t('e2e.banner.restore'), onPress: onRestore }]
        : []
  return <E2eNotice icon="unlock" tone="warning" message={t(`e2e.banner.${reason}`, { name })} actions={actions} />
}

function SystemRow({ row }: { row: DmRow }) {
  const { t } = useTranslation()
  const key = row.message.kind === 'SYSTEM_ENCRYPTION_DISABLED' ? 'e2e.system.disabled' : 'e2e.system.enabled'
  return (
    <View style={styles.systemRow}>
      <Text style={styles.systemText}>{t(key, { name: row.message.author.name })}</Text>
    </View>
  )
}

function DirectMessageRow({
  row,
  isOwn,
  showState,
  hasKeys,
  onSwipeToReply,
  onPressReplyQuote,
  onDelete,
  onRestore,
  onPressAttachment,
}: {
  row: DmRow
  isOwn: boolean
  showState: boolean
  hasKeys: boolean
  onSwipeToReply: (message: ChatConversationMessage) => void
  onPressReplyQuote: (messageId: string) => void
  onDelete: () => void
  onRestore: () => void
  onPressAttachment: (decryptedUri?: string) => void
}) {
  const { t } = useTranslation()
  const message = row.message
  const result = row.result
  const readable = row.kind === 'plain' || (row.kind === 'encrypted' && result?.status === 'ok')
  const supported = row.kind !== 'unsupported'
  const translateX = useSharedValue(0)
  const bubbleAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }))
  const replyIconAnimatedStyle = useAnimatedStyle(() => ({
    opacity: Math.min(Math.abs(translateX.value) / (MAX_SWIPE_TRANSLATION * SWIPE_REPLY_THRESHOLD_RATIO), 1),
  }))
  const panGesture = Gesture.Pan()
    .activeOffsetX([-10, 10])
    .failOffsetY([-10, 10])
    .onUpdate((event) => {
      translateX.value = isOwn
        ? Math.max(-MAX_SWIPE_TRANSLATION, Math.min(0, event.translationX))
        : Math.max(0, Math.min(MAX_SWIPE_TRANSLATION, event.translationX))
    })
    .onEnd(() => {
      if (readable && Math.abs(translateX.value) > MAX_SWIPE_TRANSLATION * SWIPE_REPLY_THRESHOLD_RATIO) {
        runOnJS(onSwipeToReply)(message)
      }
      translateX.value = withSpring(0)
    })

  const replyAttachmentLabel = (attachmentUrl: string) =>
    isVideoUrl(attachmentUrl) ? t('chat.attachmentVideo') : t('chat.attachmentPhoto')

  const replyTo = message.replyTo
  const quoteSnippet = (() => {
    if (!replyTo) return ''
    if (replyTo.encryption && replyTo.encryption !== 'none') {
      const content = getCachedContent(replyTo.id)
      if (content?.text) return content.text
      return content?.attachment ? t('chat.attachmentPhoto') : t('e2e.encryptedMessage')
    }
    return replyTo.content ?? (replyTo.attachmentUrl ? replyAttachmentLabel(replyTo.attachmentUrl) : '')
  })()

  const content = result?.status === 'ok' ? result.content : undefined
  const textColor = [styles.messageText, isOwn && styles.ownMessageText]

  return (
    <View style={[styles.messageRow, isOwn ? styles.messageRowOwn : styles.messageRowOther]}>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.replyIconWrapper,
          isOwn ? styles.replyIconWrapperOwn : styles.replyIconWrapperOther,
          replyIconAnimatedStyle,
        ]}
      >
        <Icon name="corner-up-left" size={16} color={colors.primary} />
      </Animated.View>
      <GestureDetector gesture={panGesture}>
        <Animated.View style={[styles.messageContent, bubbleAnimatedStyle]}>
          <View style={[styles.bubble, isOwn ? styles.ownBubble : styles.otherBubble]}>
            {!supported ? (
              <Text style={textColor}>{t('chat.unsupportedEncryption')}</Text>
            ) : row.kind === 'encrypted' && !content ? (
              <EncryptedProblem result={result} hasKeys={hasKeys} isOwn={isOwn} onRestore={onRestore} />
            ) : (
              <>
                {!!replyTo && (
                  <TouchableOpacity
                    style={styles.replyQuote}
                    activeOpacity={0.7}
                    onPress={() => onPressReplyQuote(replyTo.id)}
                  >
                    <View style={[styles.replyQuoteBar, isOwn ? styles.replyQuoteBarOwn : styles.replyQuoteBarOther]} />
                    <View style={styles.replyQuoteTextWrap}>
                      <Text
                        style={[
                          styles.replyQuoteAuthor,
                          isOwn ? styles.replyQuoteAuthorOwn : styles.replyQuoteAuthorOther,
                        ]}
                        numberOfLines={1}
                      >
                        {replyTo.authorName}
                      </Text>
                      <Text
                        style={[
                          styles.replyQuoteSnippet,
                          isOwn ? styles.replyQuoteSnippetOwn : styles.replyQuoteSnippetOther,
                        ]}
                        numberOfLines={1}
                      >
                        {quoteSnippet}
                      </Text>
                    </View>
                  </TouchableOpacity>
                )}
                {row.kind === 'plain' && !!message.attachmentUrl && (
                  <TouchableOpacity
                    onPress={() => onPressAttachment()}
                    accessibilityLabel={t('postDetail.viewAttachment')}
                  >
                    <MediaThumbnail
                      url={getUploadUrl(message.attachmentUrl, 'thumbnail')}
                      fallbackUrl={getUploadUrl(message.attachmentUrl)}
                      style={styles.attachment}
                    />
                  </TouchableOpacity>
                )}
                {!!content?.attachment && (
                  <EncryptedPhoto
                    messageId={message.id}
                    attachment={content.attachment}
                    style={styles.attachment}
                    onPress={(uri) => onPressAttachment(uri)}
                  />
                )}
                {row.kind === 'plain' && !!message.content && <Text style={textColor}>{message.content}</Text>}
                {!!content?.text && <Text style={textColor}>{content.text}</Text>}
              </>
            )}
            {isOwn && (
              <TouchableOpacity style={styles.delete} onPress={onDelete} accessibilityLabel={t('chat.deleteMessage')}>
                <Icon name="trash-2" size={14} color={colors.white} />
              </TouchableOpacity>
            )}
          </View>
          <View style={[styles.timeRow, isOwn && styles.timeRowOwn]}>
            {showState && supported && (
              <View
                style={styles.stateMark}
                accessibilityLabel={row.kind === 'encrypted' ? t('e2e.state.encrypted') : t('e2e.state.notEncrypted')}
              >
                <Icon name={row.kind === 'encrypted' ? 'lock' : 'unlock'} size={10} color={colors.textMuted} />
                {row.kind !== 'encrypted' && <Text style={styles.stateText}>{t('e2e.state.notEncrypted')}</Text>}
              </View>
            )}
            <Text style={styles.time}>{formatRelativeDate(message.createdAt)}</Text>
          </View>
        </Animated.View>
      </GestureDetector>
    </View>
  )
}

function EncryptedProblem({
  result,
  hasKeys,
  isOwn,
  onRestore,
}: {
  result: DmRow['result']
  hasKeys: boolean
  isOwn: boolean
  onRestore: () => void
}) {
  const { t } = useTranslation()
  if (!result || result.status === 'pending') {
    return <Text style={[styles.messageText, isOwn && styles.ownMessageText]}>{t('e2e.decrypting')}</Text>
  }
  if (result.status !== 'error') return null
  const textStyle = [styles.messageText, isOwn && styles.ownMessageText]
  return (
    <View>
      <Text style={textStyle}>{t(decryptErrorKey(result.code))}</Text>
      {result.code === 'no_key_for_me' && !hasKeys && (
        <TouchableOpacity onPress={onRestore} accessibilityRole="button">
          <Text style={[styles.problemAction, isOwn && styles.ownMessageText]}>{t('e2e.error.restoreKeys')}</Text>
        </TouchableOpacity>
      )}
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
  messageRow: { position: 'relative', maxWidth: '82%', gap: 3 },
  replyIconWrapper: {
    position: 'absolute',
    top: '50%',
    marginTop: -14,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  replyIconWrapperOwn: { right: 0 },
  replyIconWrapperOther: { left: 0 },
  messageContent: {},
  messageRowOwn: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  messageRowOther: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  bubble: { minWidth: 54, borderRadius: 18, paddingHorizontal: 13, paddingVertical: 9 },
  ownBubble: { backgroundColor: colors.primary, borderBottomRightRadius: 6 },
  otherBubble: { backgroundColor: colors.white, borderBottomLeftRadius: 6 },
  messageText: { color: colors.textBody, fontFamily: 'Nunito_400Regular', fontSize: 15, lineHeight: 20 },
  ownMessageText: { color: colors.white },
  replyQuote: {
    flexDirection: 'row',
    marginBottom: 6,
    borderRadius: 6,
    overflow: 'hidden',
  },
  replyQuoteBar: { width: 3, borderRadius: 2, marginRight: 6 },
  replyQuoteBarOwn: { backgroundColor: colors.white },
  replyQuoteBarOther: { backgroundColor: colors.primary },
  replyQuoteTextWrap: { flex: 1 },
  replyQuoteAuthor: { fontFamily: 'Nunito_700Bold', fontSize: 12 },
  replyQuoteAuthorOwn: { color: colors.white },
  replyQuoteAuthorOther: { color: colors.primary },
  replyQuoteSnippet: { fontFamily: 'Nunito_400Regular', fontSize: 12, marginTop: 1 },
  replyQuoteSnippetOwn: { color: 'rgba(255,255,255,0.85)' },
  replyQuoteSnippetOther: { color: colors.textMuted },
  attachment: { width: 220, height: 220, borderRadius: 12, marginBottom: 6, overflow: 'hidden' },
  time: { color: colors.textMuted, fontFamily: 'Nunito_400Regular', fontSize: 11 },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  timeRowOwn: { paddingRight: 4, justifyContent: 'flex-end' },
  stateMark: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  stateText: { color: colors.textMuted, fontFamily: 'Nunito_400Regular', fontSize: 11 },
  problemAction: { marginTop: 6, color: colors.primary, fontFamily: 'Nunito_700Bold', fontSize: 14 },
  systemRow: { alignSelf: 'center', paddingVertical: 6, paddingHorizontal: 12 },
  systemText: { color: colors.textMuted, fontFamily: 'Nunito_600SemiBold', fontSize: 12, textAlign: 'center' },
  delete: { alignSelf: 'flex-end', marginTop: 5 },
  replyPreviewRow: {
    backgroundColor: colors.white,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  replyPreviewBar: {
    width: 3,
    alignSelf: 'stretch',
    borderRadius: 2,
    backgroundColor: colors.primary,
  },
  replyPreviewTextWrap: { flex: 1 },
  replyPreviewAuthor: { fontFamily: 'Nunito_700Bold', fontSize: 12, color: colors.primary },
  replyPreviewSnippet: {
    fontFamily: 'Nunito_400Regular',
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 1,
  },
  replyPreviewCancel: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
