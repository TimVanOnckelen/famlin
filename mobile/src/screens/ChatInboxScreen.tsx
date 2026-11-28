import React, { useState } from 'react'
import {
  ActivityIndicator,
  Platform,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { useQueries, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  chatConversationsQueryKey,
  e2eUserIdentitiesQueryKey,
  fetchChatConversations,
  fetchUserE2eIdentities,
  type ChatConversation,
} from '@famlin/api-client'

import { colors } from '@/constants/colors'
import { Avatar } from '@/components/Avatar'
import { EmptyState } from '@/components/EmptyState'
import { Icon } from '@/components/Icon'
import { ScreenHeader } from '@/components/ScreenHeader'
import { useAuthStore } from '@/stores/authStore'
import { useDirectMessagePolicy } from '@/hooks/useServerInfo'
import { decryptChatPayload } from '@/e2e/decrypt'
import { toPublicIdentities, useE2e } from '@/e2e/useE2e'
import { useSilentE2eSetup } from '@/e2e/useSilentSetup'
import { useE2eKeysStore } from '@/e2e/keysStore'
import { shouldShowBackupReminder } from '@/e2e/backupReminder'
import { useNeedsRecoveryCode } from '@/e2e/useKeySync'
import { E2eNotice } from '@/components/E2eNotice'
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
  const [search, setSearch] = useState('')
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: chatConversationsQueryKey(),
    queryFn: fetchChatConversations,
  })
  const dmPolicy = useDirectMessagePolicy()
  // Private messages switched off by the administrator: family chats only.
  const sections = chatConversationSections(data?.items ?? [], userId, search).filter(
    (section) => !dmPolicy.disabledByAdmin || section.key === 'family'
  )
  const hasSearch = search.trim().length > 0

  // Previews of encrypted last messages are decrypted here, so the inbox needs
  // the identities of whoever wrote them.
  const e2e = useE2e()
  useSilentE2eSetup()
  const meta = useE2eKeysStore((state) => state.meta)
  const dismissReminder = useE2eKeysStore((state) => state.dismissBackupReminder)
  const needsCode = useNeedsRecoveryCode(!!e2e.serverIdentities?.[0]?.recoveryBackup)
  const showReminder = e2e.status === 'ready' && needsCode && shouldShowBackupReminder({ meta, hasBackup: false })
  const authorIds = [
    ...new Set(
      (data?.items ?? [])
        .filter((item) => item.lastMessage?.encryption === 'v1' && item.lastMessage.authorId !== userId)
        .map((item) => item.lastMessage!.authorId)
    ),
  ]
  const authorQueries = useQueries({
    queries: authorIds.map((authorId) => ({
      queryKey: e2eUserIdentitiesQueryKey(authorId),
      queryFn: () => fetchUserE2eIdentities(authorId),
      staleTime: 60 * 1000,
      enabled: (e2e.status !== 'unsupported' || e2e.serverEncryptionDisabled) && !dmPolicy.disabledByAdmin,
    })),
  })
  const identitiesByAuthor = new Map(authorIds.map((id, index) => [id, authorQueries[index]?.data]))
  const myPublic = userId ? toPublicIdentities(userId, e2e.serverIdentities) : undefined

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
          dmPolicy.disabledByAdmin ? undefined : (
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
          )
        }
      />

      <View style={styles.searchRow}>
        <Icon name="search" size={17} color={colors.textMuted} />
        <TextInput
          accessibilityLabel={t('chat.searchChats')}
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder={t('chat.searchChats')}
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
        {Platform.OS === 'android' && search.length > 0 ? (
          <TouchableOpacity
            style={styles.clearSearch}
            onPress={() => setSearch('')}
            accessibilityRole="button"
            accessibilityLabel={t('common.clear')}
          >
            <Icon name="x" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        ) : null}
      </View>

      {showReminder && (
        <E2eNotice
          icon="shield"
          message={t('e2e.reminder.text')}
          actions={[
            { label: t('e2e.reminder.action'), onPress: () => navigation.navigate('E2eBackup') },
            { label: t('e2e.reminder.dismiss'), onPress: () => void dismissReminder() },
          ]}
        />
      )}

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
            const preview = chatConversationPreview(item, (last) =>
              decryptChatPayload({
                messageId: last.id,
                conversationId: item.id,
                authorId: last.authorId,
                payload: last.encryptedPayload,
                myKeys: e2e.myKeys,
                senderIdentities:
                  last.authorId === userId
                    ? myPublic
                    : toPublicIdentities(last.authorId, identitiesByAuthor.get(last.authorId)),
              })
            )
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
                    {'encrypted' in preview && preview.encrypted && (
                      <Icon name="lock" size={12} color={colors.textMuted} />
                    )}
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
              title={t(isError ? 'chat.inboxError' : hasSearch ? 'search.emptyTitle' : 'chat.inboxEmptyTitle')}
              subtitle={t(
                isError ? 'chat.inboxErrorSubtitle' : hasSearch ? 'search.emptySubtitle' : 'chat.inboxEmptySubtitle'
              )}
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
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    margin: 16,
    marginBottom: 0,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  searchInput: { flex: 1, height: 44, color: colors.textBody, fontFamily: 'Nunito_400Regular', fontSize: 15 },
  clearSearch: {
    width: 28,
    height: 28,
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
