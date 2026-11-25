import React from 'react'
import { ActivityIndicator, SectionList, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
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
import {
  chatConversationPreview,
  chatConversationSections,
  chatConversationTitle,
  type ChatConversationSection,
} from '@/utils/chatConversations'

export function ChatInboxScreen() {
  const { t } = useTranslation()
  const navigation = useNavigation<any>()
  const userId = useAuthStore((state) => state.user?.id)
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: chatConversationsQueryKey(),
    queryFn: fetchChatConversations,
  })
  const sections = chatConversationSections(data?.items ?? [])

  function openConversation(conversation: ChatConversation) {
    if (conversation.kind === 'FAMILY' && conversation.group) {
      navigation.navigate('Chat', { groupId: conversation.group.id, groupName: conversation.group.name })
      return
    }
    navigation.navigate('DirectMessage', { conversationId: conversation.id })
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScreenHeader
        title={t('chat.inboxTitle')}
        onBack={() => navigation.goBack()}
        centered
        right={
          <View style={styles.headerRight}>
            <TouchableOpacity
              style={styles.newMessage}
              onPress={() => navigation.navigate('DmMemberPicker')}
              accessibilityRole="button"
              accessibilityLabel={t('chat.newMessage')}
            >
              <Icon name="edit" size={18} color={colors.white} />
            </TouchableOpacity>
          </View>
        }
      />

      {isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshing={false}
          onRefresh={refetch}
          renderSectionHeader={({ section }: { section: ChatConversationSection }) => (
            <Text testID={`chat-${section.key}-section`} style={styles.sectionHeader}>
              {t(section.key === 'family' ? 'chat.familyChats' : 'chat.privateMessages')}
            </Text>
          )}
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
  headerRight: {
    width: 90,
    alignItems: 'flex-end',
  },
  newMessage: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 16, flexGrow: 1 },
  sectionHeader: {
    marginTop: 8,
    marginBottom: 10,
    color: colors.textMuted,
    fontFamily: 'Nunito_700Bold',
    fontSize: 13,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    marginBottom: 10,
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
