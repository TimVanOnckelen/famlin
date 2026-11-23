import React from 'react'
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { chatConversationsQueryKey, fetchChatConversations, type ChatConversation } from '@famlin/api-client'

import { colors } from '@/constants/colors'
import { Avatar } from '@/components/Avatar'
import { EmptyState } from '@/components/EmptyState'
import { Icon } from '@/components/Icon'
import { ScreenHeader } from '@/components/ScreenHeader'
import { useAuthStore } from '@/stores/authStore'
import { formatRelativeDate } from '@/i18n/utils'
import { chatConversationPreview, chatConversationTitle } from '@/utils/chatConversations'

export function ChatInboxScreen() {
  const { t } = useTranslation()
  const navigation = useNavigation<any>()
  const userId = useAuthStore((state) => state.user?.id)
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: chatConversationsQueryKey(),
    queryFn: fetchChatConversations,
  })
  const conversations = [...(data?.items ?? [])].sort(
    (a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)
  )

  function openConversation(conversation: ChatConversation) {
    if (conversation.kind === 'FAMILY' && conversation.group) {
      navigation.navigate('Chat', { groupId: conversation.group.id, groupName: conversation.group.name })
      return
    }
    navigation.navigate('DirectMessage', { conversationId: conversation.id })
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScreenHeader title={t('chat.inboxTitle')} onBack={() => navigation.goBack()} centered />
      <TouchableOpacity
        style={styles.newMessage}
        onPress={() => navigation.navigate('DmMemberPicker')}
        accessibilityRole="button"
        accessibilityLabel={t('chat.newMessage')}
      >
        <Icon name="edit" size={18} color={colors.white} />
      </TouchableOpacity>

      {isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshing={false}
          onRefresh={refetch}
          renderItem={({ item }) => {
            const title = chatConversationTitle(item, userId)
            const preview = chatConversationPreview(item)
            const otherParticipant =
              item.kind === 'PRIVATE' ? item.participants.find((participant) => participant.id !== userId) : undefined
            return (
              <TouchableOpacity
                testID="chat-conversation-row"
                accessibilityLabel={title}
                style={styles.row}
                onPress={() => openConversation(item)}
              >
                {item.kind === 'PRIVATE' ? (
                  <Avatar name={title} avatarUrl={otherParticipant?.avatarUrl ?? null} size={48} />
                ) : (
                  <View style={styles.familyAvatar}>
                    <Icon name="users" size={21} color={colors.primary} />
                  </View>
                )}
                <View style={styles.rowContent}>
                  <View style={styles.rowTop}>
                    <Text style={styles.title} numberOfLines={1}>
                      {title}
                    </Text>
                    {!!item.lastMessage && (
                      <Text style={styles.time}>{formatRelativeDate(item.lastMessage.createdAt)}</Text>
                    )}
                  </View>
                  <View style={styles.previewRow}>
                    <Text style={styles.preview} numberOfLines={1}>
                      {preview.key === 'chat.previewText' ? preview.text : t(preview.key)}
                    </Text>
                    {item.unreadCount > 0 && (
                      <View style={styles.unread}>
                        <Text style={styles.unreadText}>{item.unreadCount > 99 ? '99+' : item.unreadCount}</Text>
                      </View>
                    )}
                  </View>
                </View>
              </TouchableOpacity>
            )
          }}
          ListEmptyComponent={
            <EmptyState
              title={t(isError ? 'chat.inboxError' : 'chat.inboxEmptyTitle')}
              subtitle={isError ? t('chat.inboxErrorSubtitle') : t('chat.inboxEmptySubtitle')}
              centerSubtitle
            />
          }
        />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  newMessage: {
    position: 'absolute',
    zIndex: 2,
    top: 16,
    right: 18,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 16, gap: 10, flexGrow: 1 },
  row: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    padding: 14,
    borderRadius: 16,
    backgroundColor: colors.white,
  },
  familyAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryTint,
  },
  rowContent: { flex: 1, minWidth: 0 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, color: colors.textTitle, fontFamily: 'Nunito_700Bold', fontSize: 16 },
  time: { color: colors.textMuted, fontFamily: 'Nunito_400Regular', fontSize: 12 },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 3 },
  preview: { flex: 1, color: colors.textMuted, fontFamily: 'Nunito_400Regular', fontSize: 14 },
  unread: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  unreadText: { color: colors.white, fontFamily: 'Nunito_700Bold', fontSize: 12 },
})
